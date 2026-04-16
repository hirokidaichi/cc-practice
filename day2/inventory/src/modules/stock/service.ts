import type { DbClient } from "../../shared/db/client.js";
import { NotFoundError } from "../../shared/errors/domain-error.js";
import { createLocationRepository } from "../location/repository.js";
import { createVariantRepository } from "../variant/repository.js";
import { createWarehouseRepository } from "../warehouse/repository.js";
import { createStockRepository } from "./repository.js";
import type { Movement, MovementQueryOpts, StockLevelDetail, StockQueryOpts } from "./schema.js";

export class StockService {
	constructor(private readonly db: DbClient) {}

	async query(opts: StockQueryOpts): Promise<StockLevelDetail[]> {
		const stockRepo = createStockRepository(this.db);
		const variantRepo = createVariantRepository(this.db);
		const warehouseRepo = createWarehouseRepository(this.db);
		const locationRepo = createLocationRepository(this.db);

		let variantId: number | undefined;
		if (opts.sku) {
			const v = await variantRepo.findBySku(opts.sku);
			if (!v) throw new NotFoundError("variant", opts.sku);
			variantId = v.id;
		}
		let warehouseId: number | undefined;
		if (opts.warehouseCode) {
			const w = await warehouseRepo.findByCode(opts.warehouseCode);
			if (!w) throw new NotFoundError("warehouse", opts.warehouseCode);
			warehouseId = w.id;
		}
		let locationId: number | undefined;
		if (opts.locationFullPath) {
			const segments = opts.locationFullPath.split("/").filter((s) => s.length > 0);
			if (segments.length < 2) throw new NotFoundError("location", opts.locationFullPath);
			const whCode = segments[0];
			if (!whCode) throw new NotFoundError("location", opts.locationFullPath);
			const w = await warehouseRepo.findByCode(whCode);
			if (!w) throw new NotFoundError("warehouse", whCode);
			const loc = await locationRepo.findByFullPath(w.id, opts.locationFullPath);
			if (!loc) throw new NotFoundError("location", opts.locationFullPath);
			locationId = loc.id;
		}

		return stockRepo.listStockDetail({
			includeZero: opts.includeZero,
			...(variantId !== undefined ? { variantId } : {}),
			...(warehouseId !== undefined ? { warehouseId } : {}),
			...(locationId !== undefined ? { locationId } : {}),
		});
	}

	async listMovements(opts: MovementQueryOpts): Promise<Movement[]> {
		const stockRepo = createStockRepository(this.db);
		const variantRepo = createVariantRepository(this.db);
		const warehouseRepo = createWarehouseRepository(this.db);
		const locationRepo = createLocationRepository(this.db);

		let variantId: number | undefined;
		if (opts.sku) {
			const v = await variantRepo.findBySku(opts.sku);
			if (!v) throw new NotFoundError("variant", opts.sku);
			variantId = v.id;
		}
		let locationId: number | undefined;
		if (opts.locationFullPath) {
			const segments = opts.locationFullPath.split("/").filter((s) => s.length > 0);
			const whCode = segments[0];
			if (!whCode) throw new NotFoundError("location", opts.locationFullPath);
			const w = await warehouseRepo.findByCode(whCode);
			if (!w) throw new NotFoundError("warehouse", whCode);
			const loc = await locationRepo.findByFullPath(w.id, opts.locationFullPath);
			if (!loc) throw new NotFoundError("location", opts.locationFullPath);
			locationId = loc.id;
		}

		return stockRepo.listMovements({
			limit: opts.limit,
			offset: opts.offset,
			...(variantId !== undefined ? { variantId } : {}),
			...(locationId !== undefined ? { locationId } : {}),
			...(opts.movementType !== undefined ? { movementType: opts.movementType } : {}),
		});
	}
}
