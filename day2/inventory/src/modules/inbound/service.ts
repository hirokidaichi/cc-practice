import type { DbClient } from "../../shared/db/client.js";
import { pushCostLayer } from "../../shared/db/fifo.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { createLocationRepository } from "../location/repository.js";
import { createStockRepository } from "../stock/repository.js";
import { createVariantRepository } from "../variant/repository.js";
import { createWarehouseRepository } from "../warehouse/repository.js";
import { createInboundRepository } from "./repository.js";
import type { GoodsReceiptLine, ReceiveInput, ReceiveResult } from "./schema.js";

export function generateReceiptNumber(now: Date = new Date()): string {
	const y = now.getUTCFullYear();
	const m = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const ts = String(now.getTime() % 100000000).padStart(8, "0");
	const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
	return `GR-${y}${m}${d}-${ts}-${rand}`;
}

function nowIso(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class InboundService {
	constructor(private readonly db: DbClient) {}

	async receive(input: ReceiveInput): Promise<ReceiveResult> {
		if (input.lines.length === 0) throw new ValidationError("at least one line required");

		return withTransaction(this.db, async (tx) => {
			const warehouseRepo = createWarehouseRepository(tx);
			const variantRepo = createVariantRepository(tx);
			const locationRepo = createLocationRepository(tx);
			const stockRepo = createStockRepository(tx);
			const inboundRepo = createInboundRepository(tx);

			const warehouse = await warehouseRepo.findByCode(input.warehouseCode);
			if (!warehouse) throw new NotFoundError("warehouse", input.warehouseCode);
			if (!warehouse.isActive) {
				throw new ConflictError(`warehouse is archived: ${input.warehouseCode}`);
			}

			let supplierId: number | null = null;
			if (input.supplierCode) {
				const supplier = await inboundRepo.findSupplierByCode(input.supplierCode);
				if (!supplier) throw new NotFoundError("supplier", input.supplierCode);
				supplierId = supplier.id;
			}

			const receivedAt = input.receivedAt ?? nowIso();
			const receiptNumber = generateReceiptNumber(new Date(receivedAt.replace(" ", "T")));

			const receiptId = await inboundRepo.createReceipt({
				receiptNumber,
				supplierId,
				warehouseId: warehouse.id,
				receivedAt,
				note: input.note ?? null,
			});

			const linesResult: GoodsReceiptLine[] = [];
			for (const line of input.lines) {
				const variant = await variantRepo.findBySku(line.sku);
				if (!variant) throw new NotFoundError("variant", line.sku);
				if (variant.variantType !== "simple") {
					throw new ValidationError(
						`cannot receive inventory for a non-simple variant: ${line.sku}`,
					);
				}
				if (!variant.isActive) {
					throw new ConflictError(`variant is archived: ${line.sku}`);
				}

				const location = await locationRepo.findByFullPath(warehouse.id, line.locationFullPath);
				if (!location) throw new NotFoundError("location", line.locationFullPath);
				if (!location.isActive) {
					throw new ConflictError(`location is archived: ${line.locationFullPath}`);
				}

				const lineId = await inboundRepo.createReceiptLine({
					receiptId,
					variantId: variant.id,
					locationId: location.id,
					qty: line.qty,
					unitCost: line.unitCost,
				});

				await pushCostLayer(tx, {
					variantId: variant.id,
					warehouseId: warehouse.id,
					receivedAt,
					unitCost: line.unitCost,
					qty: line.qty,
					receiptLineId: lineId,
				});

				await stockRepo.adjustStock({
					variantId: variant.id,
					locationId: location.id,
					onHandDelta: line.qty,
					reservedDelta: 0,
					occurredAt: receivedAt,
				});

				await stockRepo.recordMovement({
					variantId: variant.id,
					locationId: location.id,
					movementType: "inbound",
					qty: line.qty,
					unitCost: line.unitCost,
					refType: "goods_receipt",
					refId: receiptId,
					occurredAt: receivedAt,
				});

				linesResult.push({
					id: lineId,
					receiptId,
					variantId: variant.id,
					locationId: location.id,
					qty: line.qty,
					unitCost: line.unitCost,
				});
			}

			const receipt = await inboundRepo.findReceiptById(receiptId);
			if (!receipt) throw new Error("failed to reload goods receipt");
			return { receipt, lines: linesResult };
		});
	}

	async findReceiptByNumber(receiptNumber: string): Promise<ReceiveResult | null> {
		const inboundRepo = createInboundRepository(this.db);
		const receipt = await inboundRepo.findReceiptByNumber(receiptNumber);
		if (!receipt) return null;
		const lines = await inboundRepo.listLines(receipt.id);
		return { receipt, lines };
	}

	async requireReceiptByNumber(receiptNumber: string): Promise<ReceiveResult> {
		const r = await this.findReceiptByNumber(receiptNumber);
		if (!r) throw new NotFoundError("goods receipt", receiptNumber);
		return r;
	}
}
