import type { DbClient } from "../../shared/db/client.js";
import { consumeCostLayers, pushCostLayer } from "../../shared/db/fifo.js";
import { type DbExecutor, withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { createLocationRepository } from "../location/repository.js";
import type { Location } from "../location/schema.js";
import { createStockRepository } from "../stock/repository.js";
import { createVariantRepository } from "../variant/repository.js";
import type { Variant } from "../variant/schema.js";
import { createWarehouseRepository } from "../warehouse/repository.js";
import type {
	AdjustInput,
	FifoConsumptionSummary,
	PickInput,
	PickResult,
	TransferInput,
	TransferResult,
} from "./schema.js";

function nowIso(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function resolveVariantAndLocation(
	tx: DbExecutor,
	sku: string,
	fullPath: string,
): Promise<{ variant: Variant; location: Location }> {
	const variant = await createVariantRepository(tx).findBySku(sku);
	if (!variant) throw new NotFoundError("variant", sku);
	if (variant.variantType !== "simple") {
		throw new ValidationError(`not a simple variant: ${sku}`);
	}

	const segments = fullPath.split("/").filter((s) => s.length > 0);
	const whCode = segments[0];
	if (!whCode) throw new NotFoundError("location", fullPath);
	const warehouse = await createWarehouseRepository(tx).findByCode(whCode);
	if (!warehouse) throw new NotFoundError("warehouse", whCode);
	const location = await createLocationRepository(tx).findByFullPath(warehouse.id, fullPath);
	if (!location) throw new NotFoundError("location", fullPath);
	return { variant, location };
}

async function resolveWarehouseIdFromLocation(tx: DbExecutor, locationId: number): Promise<number> {
	const loc = await createLocationRepository(tx).findById(locationId);
	if (!loc) throw new NotFoundError("location", locationId);
	return loc.warehouseId;
}

export class OutboundService {
	constructor(private readonly db: DbClient) {}

	async pick(input: PickInput): Promise<PickResult> {
		if (input.qty <= 0) throw new ValidationError("qty must be positive");
		return withTransaction(this.db, async (tx) => {
			const { variant, location } = await resolveVariantAndLocation(
				tx,
				input.sku,
				input.locationFullPath,
			);
			const warehouseId = await resolveWarehouseIdFromLocation(tx, location.id);
			const occurredAt = input.occurredAt ?? nowIso();

			const stockRepo = createStockRepository(tx);
			const current = await stockRepo.findByVariantAndLocation(variant.id, location.id);
			if (!current || current.availableQty < input.qty) {
				throw new ConflictError(
					`insufficient available stock at ${input.locationFullPath}: have=${current?.availableQty ?? 0} want=${input.qty}`,
					{
						sku: input.sku,
						locationFullPath: input.locationFullPath,
						have: current?.availableQty ?? 0,
						want: input.qty,
					},
				);
			}

			const fifo = await consumeCostLayers(tx, {
				variantId: variant.id,
				warehouseId,
				qty: input.qty,
			});

			await stockRepo.adjustStock({
				variantId: variant.id,
				locationId: location.id,
				onHandDelta: -input.qty,
				reservedDelta: 0,
				occurredAt,
			});

			const movementArgs: Parameters<
				ReturnType<typeof createStockRepository>["recordMovement"]
			>[0] = {
				variantId: variant.id,
				locationId: location.id,
				movementType: "outbound",
				qty: -input.qty,
				unitCost: fifo.weightedAvgCost,
				occurredAt,
			};
			if (input.refType !== undefined) movementArgs.refType = input.refType;
			if (input.refId !== undefined) movementArgs.refId = input.refId;
			if (input.note !== undefined) movementArgs.note = input.note;
			const movementId = await stockRepo.recordMovement(movementArgs);

			return {
				variantId: variant.id,
				locationId: location.id,
				qty: input.qty,
				totalCost: fifo.totalCost,
				weightedAvgCost: fifo.weightedAvgCost,
				consumptions: fifo.consumptions,
				movementId,
			};
		});
	}

	/**
	 * Remove stock for shrinkage/discrepancy (negative adjustment). Consumes from FIFO
	 * layers just like an outbound pick, but tagged with movement_type='adjustment'.
	 */
	async adjustOut(input: AdjustInput): Promise<PickResult> {
		if (input.qty <= 0) throw new ValidationError("qty must be positive");
		return withTransaction(this.db, async (tx) => {
			const { variant, location } = await resolveVariantAndLocation(
				tx,
				input.sku,
				input.locationFullPath,
			);
			const warehouseId = await resolveWarehouseIdFromLocation(tx, location.id);
			const occurredAt = input.occurredAt ?? nowIso();

			const stockRepo = createStockRepository(tx);
			const current = await stockRepo.findByVariantAndLocation(variant.id, location.id);
			if (!current || current.availableQty < input.qty) {
				throw new ConflictError(
					`insufficient available stock to adjust out: ${input.locationFullPath}`,
					{ have: current?.availableQty ?? 0, want: input.qty },
				);
			}

			const fifo = await consumeCostLayers(tx, {
				variantId: variant.id,
				warehouseId,
				qty: input.qty,
			});

			await stockRepo.adjustStock({
				variantId: variant.id,
				locationId: location.id,
				onHandDelta: -input.qty,
				reservedDelta: 0,
				occurredAt,
			});

			const movementArgs: Parameters<
				ReturnType<typeof createStockRepository>["recordMovement"]
			>[0] = {
				variantId: variant.id,
				locationId: location.id,
				movementType: "adjustment",
				qty: -input.qty,
				unitCost: fifo.weightedAvgCost,
				refType: "adjustment",
				occurredAt,
			};
			if (input.note !== undefined) movementArgs.note = input.note;
			const movementId = await stockRepo.recordMovement(movementArgs);

			return {
				variantId: variant.id,
				locationId: location.id,
				qty: input.qty,
				totalCost: fifo.totalCost,
				weightedAvgCost: fifo.weightedAvgCost,
				consumptions: fifo.consumptions,
				movementId,
			};
		});
	}

	async transfer(input: TransferInput): Promise<TransferResult> {
		if (input.qty <= 0) throw new ValidationError("qty must be positive");
		if (input.fromLocationFullPath === input.toLocationFullPath) {
			throw new ValidationError("from and to must differ");
		}
		return withTransaction(this.db, async (tx) => {
			const variantRepo = createVariantRepository(tx);
			const variant = await variantRepo.findBySku(input.sku);
			if (!variant) throw new NotFoundError("variant", input.sku);
			if (variant.variantType !== "simple") {
				throw new ValidationError(`not a simple variant: ${input.sku}`);
			}

			const warehouseRepo = createWarehouseRepository(tx);
			const locRepo = createLocationRepository(tx);
			const stockRepo = createStockRepository(tx);

			const fromSegments = input.fromLocationFullPath.split("/").filter(Boolean);
			const toSegments = input.toLocationFullPath.split("/").filter(Boolean);
			const fromWhCode = fromSegments[0];
			const toWhCode = toSegments[0];
			if (!fromWhCode || !toWhCode) {
				throw new NotFoundError(
					"location",
					`${input.fromLocationFullPath} or ${input.toLocationFullPath}`,
				);
			}

			const fromWh = await warehouseRepo.findByCode(fromWhCode);
			if (!fromWh) throw new NotFoundError("warehouse", fromWhCode);
			const toWh = await warehouseRepo.findByCode(toWhCode);
			if (!toWh) throw new NotFoundError("warehouse", toWhCode);
			if (!toWh.isActive) throw new ConflictError(`warehouse is archived: ${toWhCode}`);

			const fromLoc = await locRepo.findByFullPath(fromWh.id, input.fromLocationFullPath);
			if (!fromLoc) throw new NotFoundError("location", input.fromLocationFullPath);
			const toLoc = await locRepo.findByFullPath(toWh.id, input.toLocationFullPath);
			if (!toLoc) throw new NotFoundError("location", input.toLocationFullPath);
			if (!toLoc.isActive) {
				throw new ConflictError(`location is archived: ${input.toLocationFullPath}`);
			}

			const occurredAt = input.occurredAt ?? nowIso();
			const currentFrom = await stockRepo.findByVariantAndLocation(variant.id, fromLoc.id);
			if (!currentFrom || currentFrom.availableQty < input.qty) {
				throw new ConflictError(`insufficient available stock at ${input.fromLocationFullPath}`, {
					have: currentFrom?.availableQty ?? 0,
					want: input.qty,
				});
			}

			const crossWarehouse = fromWh.id !== toWh.id;

			// For cross-warehouse moves we consume source FIFO layers and push a new layer
			// on the destination warehouse at the weighted-average cost. Intra-warehouse
			// moves leave cost_layers untouched (FIFO order is preserved within the
			// warehouse regardless of physical location).
			let totalCost: number | undefined;
			let weightedAvgCost: number | undefined;
			let consumptions: FifoConsumptionSummary[] | undefined;
			if (crossWarehouse) {
				const fifo = await consumeCostLayers(tx, {
					variantId: variant.id,
					warehouseId: fromWh.id,
					qty: input.qty,
				});
				totalCost = fifo.totalCost;
				weightedAvgCost = fifo.weightedAvgCost;
				consumptions = fifo.consumptions;
				await pushCostLayer(tx, {
					variantId: variant.id,
					warehouseId: toWh.id,
					receivedAt: occurredAt,
					unitCost: fifo.weightedAvgCost,
					qty: input.qty,
				});
			}

			await stockRepo.adjustStock({
				variantId: variant.id,
				locationId: fromLoc.id,
				onHandDelta: -input.qty,
				reservedDelta: 0,
				occurredAt,
			});
			await stockRepo.adjustStock({
				variantId: variant.id,
				locationId: toLoc.id,
				onHandDelta: input.qty,
				reservedDelta: 0,
				occurredAt,
			});

			const movementOutArgs: Parameters<
				ReturnType<typeof createStockRepository>["recordMovement"]
			>[0] = {
				variantId: variant.id,
				locationId: fromLoc.id,
				movementType: "transfer_out",
				qty: -input.qty,
				refType: "transfer",
				occurredAt,
			};
			if (weightedAvgCost !== undefined) movementOutArgs.unitCost = weightedAvgCost;
			if (input.note !== undefined) movementOutArgs.note = input.note;
			const movementOutId = await stockRepo.recordMovement(movementOutArgs);

			const movementInArgs: Parameters<
				ReturnType<typeof createStockRepository>["recordMovement"]
			>[0] = {
				variantId: variant.id,
				locationId: toLoc.id,
				movementType: "transfer_in",
				qty: input.qty,
				refType: "transfer",
				refId: movementOutId,
				occurredAt,
			};
			if (weightedAvgCost !== undefined) movementInArgs.unitCost = weightedAvgCost;
			if (input.note !== undefined) movementInArgs.note = input.note;
			const movementInId = await stockRepo.recordMovement(movementInArgs);

			return {
				variantId: variant.id,
				fromLocationId: fromLoc.id,
				toLocationId: toLoc.id,
				qty: input.qty,
				crossWarehouse,
				movementOutId,
				movementInId,
				...(weightedAvgCost !== undefined ? { weightedAvgCost } : {}),
				...(totalCost !== undefined ? { totalCost } : {}),
				...(consumptions !== undefined ? { consumptions } : {}),
			};
		});
	}
}
