import type { DbClient } from "../../shared/db/client.js";
import { consumeCostLayers } from "../../shared/db/fifo.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { createOrderRepository } from "../order/repository.js";
import type { OrderLineAllocation, SalesOrderLine } from "../order/schema.js";
import { createStockRepository } from "../stock/repository.js";
import { createShipmentRepository } from "./repository.js";
import type { ListShipmentsOpts, ShipInput, Shipment, ShipmentDetail } from "./schema.js";

function nowIso(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function generateShipmentNumber(now: Date = new Date()): string {
	const y = now.getUTCFullYear();
	const m = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const ts = String(now.getTime() % 100000000).padStart(8, "0");
	const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
	return `SH-${y}${m}${d}-${ts}-${rand}`;
}

interface AllocationByLine {
	line: SalesOrderLine;
	allocations: OrderLineAllocation[];
}

function groupByLine(
	lines: SalesOrderLine[],
	allocations: OrderLineAllocation[],
): AllocationByLine[] {
	return lines.map((line) => ({
		line,
		allocations: allocations.filter((a) => a.orderLineId === line.id),
	}));
}

export class ShipmentService {
	constructor(private readonly db: DbClient) {}

	async ship(input: ShipInput): Promise<ShipmentDetail> {
		return withTransaction(this.db, async (tx) => {
			const orderRepo = createOrderRepository(tx);
			const shipmentRepo = createShipmentRepository(tx);
			const stockRepo = createStockRepository(tx);

			const order = await orderRepo.findByNumber(input.orderNumber);
			if (!order) throw new NotFoundError("sales order", input.orderNumber);
			if (order.status !== "confirmed") {
				throw new ConflictError(
					`order must be 'confirmed' to ship; current status=${order.status}`,
					{ orderNumber: input.orderNumber, status: order.status },
				);
			}

			const lines = await orderRepo.listLines(order.id);
			const allocations = await orderRepo.listAllocationsByOrder(order.id);
			if (allocations.length === 0) {
				throw new ConflictError(`no allocations found on confirmed order: ${input.orderNumber}`);
			}

			const shippedAt = input.shippedAt ?? nowIso();
			const shipmentNumber = generateShipmentNumber(new Date(shippedAt.replace(" ", "T")));

			const shipmentId = await shipmentRepo.create({
				shipmentNumber,
				orderId: order.id,
				warehouseId: order.warehouseId,
				carrier: input.carrier ?? null,
				trackingNumber: input.trackingNumber ?? null,
				status: "shipped",
				shippedAt,
				note: input.note ?? null,
			});

			const grouped = groupByLine(lines, allocations);
			let totalCogs = 0;

			for (const g of grouped) {
				// For each component variant within a line, consume FIFO layers in one go,
				// then distribute the resulting cost across the line's allocations in the
				// same variant/warehouse by qty share.
				const byVariant = new Map<number, OrderLineAllocation[]>();
				for (const a of g.allocations) {
					const arr = byVariant.get(a.componentVariantId) ?? [];
					arr.push(a);
					byVariant.set(a.componentVariantId, arr);
				}

				let lineCost = 0;
				for (const [componentVariantId, allocs] of byVariant) {
					const totalQty = allocs.reduce((s, a) => s + a.allocatedQty, 0);
					const fifo = await consumeCostLayers(tx, {
						variantId: componentVariantId,
						warehouseId: order.warehouseId,
						qty: totalQty,
					});
					lineCost += fifo.totalCost;

					for (const a of allocs) {
						const share = Math.floor((fifo.totalCost * a.allocatedQty) / totalQty);
						await shipmentRepo.updateAllocationConsumedCost(a.id, share);

						await stockRepo.adjustStock({
							variantId: a.componentVariantId,
							locationId: a.locationId,
							onHandDelta: -a.allocatedQty,
							reservedDelta: -a.allocatedQty,
							occurredAt: shippedAt,
						});

						await stockRepo.recordMovement({
							variantId: a.componentVariantId,
							locationId: a.locationId,
							movementType: "outbound",
							qty: -a.allocatedQty,
							unitCost: fifo.weightedAvgCost,
							refType: "shipment",
							refId: shipmentId,
							occurredAt: shippedAt,
						});
					}
				}

				const capturedUnitCost = Math.floor(lineCost / g.line.qty);
				await shipmentRepo.updateOrderLineCapturedCost(g.line.id, capturedUnitCost);

				await shipmentRepo.createLine({
					shipmentId,
					orderLineId: g.line.id,
					qty: g.line.qty,
				});

				totalCogs += lineCost;
			}

			// GL 記帳: AR (debit) / Sales (credit), COGS (debit) / Inventory (credit)
			const entryDate = shippedAt.slice(0, 10);
			const glCommon = {
				entryDate,
				refType: "shipment" as const,
				refId: shipmentId,
				note: `ship order ${order.orderNumber}`,
			};
			await shipmentRepo.insertGlEntry({
				...glCommon,
				account: "ar",
				debit: order.totalAmount,
				credit: 0,
			});
			await shipmentRepo.insertGlEntry({
				...glCommon,
				account: "sales",
				debit: 0,
				credit: order.totalAmount,
			});
			await shipmentRepo.insertGlEntry({
				...glCommon,
				account: "cogs",
				debit: totalCogs,
				credit: 0,
			});
			await shipmentRepo.insertGlEntry({
				...glCommon,
				account: "inventory",
				debit: 0,
				credit: totalCogs,
			});

			await orderRepo.updateStatus(order.id, "shipped", "shipped_at", shippedAt);

			const shipment = await shipmentRepo.findById(shipmentId);
			if (!shipment) throw new Error("failed to reload shipment");
			const shipmentLines = await shipmentRepo.listLines(shipmentId);
			return {
				shipment,
				lines: shipmentLines,
				totalCost: totalCogs,
				totalRevenue: order.totalAmount,
			};
		});
	}

	async markDelivered(shipmentNumber: string, deliveredAt?: string): Promise<ShipmentDetail> {
		return withTransaction(this.db, async (tx) => {
			const shipmentRepo = createShipmentRepository(tx);
			const orderRepo = createOrderRepository(tx);

			const shipment = await shipmentRepo.findByNumber(shipmentNumber);
			if (!shipment) throw new NotFoundError("shipment", shipmentNumber);
			if (shipment.status === "delivered") {
				const lines = await shipmentRepo.listLines(shipment.id);
				return {
					shipment,
					lines,
					totalCost: 0,
					totalRevenue: 0,
				};
			}
			if (shipment.status !== "shipped" && shipment.status !== "in_transit") {
				throw new ConflictError(
					`cannot mark delivered from status '${shipment.status}': ${shipmentNumber}`,
				);
			}
			const at = deliveredAt ?? nowIso();
			await shipmentRepo.updateStatus(shipment.id, "delivered", "delivered_at", at);

			// MVP: 1 注文 = 1 shipment なので、shipment delivered = order delivered。
			await orderRepo.updateStatus(shipment.orderId, "delivered", "delivered_at", at);

			const reloaded = await shipmentRepo.findById(shipment.id);
			if (!reloaded) throw new Error("failed to reload shipment");
			const lines = await shipmentRepo.listLines(shipment.id);
			return {
				shipment: reloaded,
				lines,
				totalCost: 0,
				totalRevenue: 0,
			};
		});
	}

	async findByNumber(shipmentNumber: string): Promise<ShipmentDetail | null> {
		const repo = createShipmentRepository(this.db);
		const shipment = await repo.findByNumber(shipmentNumber);
		if (!shipment) return null;
		const lines = await repo.listLines(shipment.id);
		return { shipment, lines, totalCost: 0, totalRevenue: 0 };
	}

	async requireByNumber(shipmentNumber: string): Promise<ShipmentDetail> {
		const d = await this.findByNumber(shipmentNumber);
		if (!d) throw new NotFoundError("shipment", shipmentNumber);
		return d;
	}

	async list(opts: ListShipmentsOpts): Promise<{ items: Shipment[]; total: number }> {
		return createShipmentRepository(this.db).list(opts);
	}
}
