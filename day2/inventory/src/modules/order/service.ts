import type { DbClient } from "../../shared/db/client.js";
import { type DbExecutor, withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { createStockRepository } from "../stock/repository.js";
import { createVariantRepository } from "../variant/repository.js";
import { createWarehouseRepository } from "../warehouse/repository.js";
import { createOrderRepository } from "./repository.js";
import type {
	CreateOrderInput,
	CreateOrderLineInput,
	ListOrdersOpts,
	OrderStatus,
	SalesOrder,
	SalesOrderDetail,
} from "./schema.js";

function nowIso(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function generateOrderNumber(now: Date = new Date()): string {
	const y = now.getUTCFullYear();
	const m = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const ts = String(now.getTime() % 100000000).padStart(8, "0");
	const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
	return `SO-${y}${m}${d}-${ts}-${rand}`;
}

interface ComponentRequirement {
	componentVariantId: number;
	componentSku: string;
	totalRequiredQty: number;
}

async function expandLineToComponentRequirements(
	tx: DbExecutor,
	variantId: number,
	qty: number,
): Promise<ComponentRequirement[]> {
	const variantRepo = createVariantRepository(tx);
	const variant = await variantRepo.findById(variantId);
	if (!variant) throw new NotFoundError("variant", variantId);
	if (variant.variantType === "simple") {
		return [
			{
				componentVariantId: variant.id,
				componentSku: variant.sku,
				totalRequiredQty: qty,
			},
		];
	}
	const components = await variantRepo.listBundleComponentsDetailed(variant.id);
	if (components.length === 0) {
		throw new ValidationError(`bundle has no components: ${variant.sku}`);
	}
	return components.map((c) => ({
		componentVariantId: c.componentVariantId,
		componentSku: c.componentSku,
		totalRequiredQty: c.qty * qty,
	}));
}

export class OrderService {
	constructor(private readonly db: DbClient) {}

	async create(input: CreateOrderInput): Promise<SalesOrderDetail> {
		return withTransaction(this.db, async (tx) => {
			const orderRepo = createOrderRepository(tx);
			const variantRepo = createVariantRepository(tx);
			const warehouseRepo = createWarehouseRepository(tx);

			const customer = await orderRepo.findCustomerByCode(input.customerCode);
			if (!customer) throw new NotFoundError("customer", input.customerCode);

			const warehouse = await warehouseRepo.findByCode(input.warehouseCode);
			if (!warehouse) throw new NotFoundError("warehouse", input.warehouseCode);
			if (!warehouse.isActive) {
				throw new ConflictError(`warehouse is archived: ${input.warehouseCode}`);
			}

			const orderedAt = input.orderedAt ?? nowIso();
			const orderNumber = generateOrderNumber(new Date(orderedAt.replace(" ", "T")));

			// Resolve each line's variant and freeze the unit_price snapshot.
			const resolvedLines: {
				input: CreateOrderLineInput;
				variantId: number;
				unitPrice: number;
			}[] = [];
			for (const line of input.lines) {
				const variant = await variantRepo.findBySku(line.sku);
				if (!variant) throw new NotFoundError("variant", line.sku);
				if (!variant.isActive) {
					throw new ConflictError(`variant is archived: ${line.sku}`);
				}
				const unitPrice = line.unitPrice ?? variant.unitPrice;
				resolvedLines.push({ input: line, variantId: variant.id, unitPrice });
			}

			const subtotal = resolvedLines.reduce((s, r) => s + r.unitPrice * r.input.qty, 0);
			const discount = resolvedLines.reduce((s, r) => s + r.input.lineDiscount, 0);
			const total = Math.max(0, subtotal - discount);

			const orderId = await orderRepo.createOrder({
				orderNumber,
				customerId: customer.id,
				warehouseId: warehouse.id,
				status: "pending",
				subtotalAmount: subtotal,
				discountAmount: discount,
				totalAmount: total,
				orderedAt,
				note: input.note ?? null,
			});

			for (let i = 0; i < resolvedLines.length; i++) {
				const r = resolvedLines[i];
				if (!r) continue;
				await orderRepo.createLine({
					orderId,
					variantId: r.variantId,
					qty: r.input.qty,
					unitPrice: r.unitPrice,
					lineDiscount: r.input.lineDiscount,
					sortOrder: i,
				});
			}

			return this.loadDetailInTx(tx, orderId);
		});
	}

	async confirm(orderNumber: string): Promise<SalesOrderDetail> {
		return withTransaction(this.db, async (tx) => {
			const orderRepo = createOrderRepository(tx);
			const stockRepo = createStockRepository(tx);

			const order = await orderRepo.findByNumber(orderNumber);
			if (!order) throw new NotFoundError("sales order", orderNumber);
			if (order.status !== "pending") {
				throw new ConflictError(`cannot confirm order in status '${order.status}': ${orderNumber}`);
			}

			const lines = await orderRepo.listLines(order.id);
			const occurredAt = nowIso();

			for (const line of lines) {
				const requirements = await expandLineToComponentRequirements(tx, line.variantId, line.qty);
				for (const req of requirements) {
					const availableLocs = await orderRepo.listComponentAvailability(
						req.componentVariantId,
						order.warehouseId,
					);
					let remaining = req.totalRequiredQty;
					for (const loc of availableLocs) {
						if (remaining <= 0) break;
						const take = Math.min(remaining, loc.availableQty);
						if (take <= 0) continue;

						await stockRepo.adjustStock({
							variantId: req.componentVariantId,
							locationId: loc.locationId,
							onHandDelta: 0,
							reservedDelta: take,
							occurredAt,
						});

						await orderRepo.createAllocation({
							orderLineId: line.id,
							componentVariantId: req.componentVariantId,
							locationId: loc.locationId,
							allocatedQty: take,
						});

						await stockRepo.recordMovement({
							variantId: req.componentVariantId,
							locationId: loc.locationId,
							movementType: "reserve",
							qty: -take,
							refType: "sales_order",
							refId: order.id,
							occurredAt,
						});

						remaining -= take;
					}
					if (remaining > 0) {
						throw new ConflictError(
							`insufficient stock to reserve for order ${orderNumber}: sku=${req.componentSku} short=${remaining}`,
							{
								orderNumber,
								sku: req.componentSku,
								short: remaining,
							},
						);
					}
				}
			}

			await orderRepo.updateStatus(order.id, "confirmed", "confirmed_at", occurredAt);
			return this.loadDetailInTx(tx, order.id);
		});
	}

	async cancel(orderNumber: string): Promise<SalesOrderDetail> {
		return withTransaction(this.db, async (tx) => {
			const orderRepo = createOrderRepository(tx);
			const stockRepo = createStockRepository(tx);

			const order = await orderRepo.findByNumber(orderNumber);
			if (!order) throw new NotFoundError("sales order", orderNumber);
			if (order.status === "shipped" || order.status === "delivered") {
				throw new ConflictError(
					`cannot cancel order after shipment (status=${order.status}): ${orderNumber}`,
				);
			}
			if (order.status === "cancelled") return this.loadDetailInTx(tx, order.id);

			const occurredAt = nowIso();
			if (order.status === "confirmed") {
				const allocations = await orderRepo.listAllocationsByOrder(order.id);
				for (const alloc of allocations) {
					await stockRepo.adjustStock({
						variantId: alloc.componentVariantId,
						locationId: alloc.locationId,
						onHandDelta: 0,
						reservedDelta: -alloc.allocatedQty,
						occurredAt,
					});
					await stockRepo.recordMovement({
						variantId: alloc.componentVariantId,
						locationId: alloc.locationId,
						movementType: "release",
						qty: alloc.allocatedQty,
						refType: "sales_order",
						refId: order.id,
						occurredAt,
					});
				}
				await orderRepo.deleteAllocationsByOrder(order.id);
			}

			await orderRepo.updateStatus(order.id, "cancelled", "cancelled_at", occurredAt);
			return this.loadDetailInTx(tx, order.id);
		});
	}

	async findByNumber(orderNumber: string): Promise<SalesOrderDetail | null> {
		const repo = createOrderRepository(this.db);
		const order = await repo.findByNumber(orderNumber);
		if (!order) return null;
		return this.loadDetailInTx(this.db, order.id);
	}

	async requireByNumber(orderNumber: string): Promise<SalesOrderDetail> {
		const d = await this.findByNumber(orderNumber);
		if (!d) throw new NotFoundError("sales order", orderNumber);
		return d;
	}

	async list(opts: ListOrdersOpts): Promise<{ items: SalesOrder[]; total: number }> {
		return createOrderRepository(this.db).list(opts);
	}

	private async loadDetailInTx(tx: DbExecutor, orderId: number): Promise<SalesOrderDetail> {
		const repo = createOrderRepository(tx);
		const order = await repo.findById(orderId);
		if (!order) throw new Error("failed to reload order");
		const lines = await repo.listLines(orderId);
		const allocations = await repo.listAllocationsByOrder(orderId);
		return { order, lines, allocations };
	}
}

// satisfy unused-type linter
export type _OrderStatus = OrderStatus;
