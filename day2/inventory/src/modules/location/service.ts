import type { DbClient } from "../../shared/db/client.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { createWarehouseRepository } from "../warehouse/repository.js";
import { createLocationRepository } from "./repository.js";
import type { CreateLocationInput, ListLocationsOpts, Location, LocationNode } from "./schema.js";

function splitPath(raw: string): string[] {
	return raw.split("/").filter((s) => s.length > 0);
}

function joinPath(segments: string[]): string {
	return segments.join("/");
}

export class LocationService {
	constructor(private readonly db: DbClient) {}

	async create(input: CreateLocationInput): Promise<Location> {
		const segments = splitPath(input.path);
		if (segments.length === 0) throw new ValidationError("path cannot be empty");
		const last = segments[segments.length - 1];
		if (!last) throw new ValidationError("path cannot end with '/'");

		return withTransaction(this.db, async (tx) => {
			const warehouse = await createWarehouseRepository(tx).findByCode(input.warehouseCode);
			if (!warehouse) throw new NotFoundError("warehouse", input.warehouseCode);
			if (!warehouse.isActive) {
				throw new ConflictError(`warehouse is archived: ${input.warehouseCode}`);
			}

			const locRepo = createLocationRepository(tx);
			let parentId: number | null = null;
			for (let i = 0; i < segments.length - 1; i++) {
				const ancestorPath = `${warehouse.code}/${joinPath(segments.slice(0, i + 1))}`;
				const ancestor = await locRepo.findByFullPath(warehouse.id, ancestorPath);
				if (!ancestor) {
					throw new NotFoundError("parent location", ancestorPath);
				}
				parentId = ancestor.id;
			}

			const fullPath = `${warehouse.code}/${joinPath(segments)}`;
			const existing = await locRepo.findByFullPath(warehouse.id, fullPath);
			if (existing) {
				throw new ConflictError(`location already exists: ${fullPath}`, { fullPath });
			}

			const id = await locRepo.create({
				warehouseId: warehouse.id,
				parentLocationId: parentId,
				code: last,
				fullPath,
				locationType: input.locationType,
			});
			const created = await locRepo.findById(id);
			if (!created) throw new Error("failed to reload created location");
			return created;
		});
	}

	async resolveByFullPath(fullPath: string): Promise<Location | null> {
		const segments = splitPath(fullPath);
		if (segments.length < 2) return null;
		const warehouseCode = segments[0];
		if (!warehouseCode) return null;
		const warehouse = await createWarehouseRepository(this.db).findByCode(warehouseCode);
		if (!warehouse) return null;
		const repo = createLocationRepository(this.db);
		return repo.findByFullPath(warehouse.id, fullPath);
	}

	async requireByFullPath(fullPath: string): Promise<Location> {
		const loc = await this.resolveByFullPath(fullPath);
		if (!loc) throw new NotFoundError("location", fullPath);
		return loc;
	}

	async list(opts: ListLocationsOpts): Promise<Location[]> {
		const warehouse = await createWarehouseRepository(this.db).findByCode(opts.warehouseCode);
		if (!warehouse) throw new NotFoundError("warehouse", opts.warehouseCode);
		const repo = createLocationRepository(this.db);
		const listOpts: { parentId?: number | null; includeInactive: boolean } = {
			includeInactive: opts.includeInactive,
		};
		if (opts.parentFullPath !== undefined) {
			const parent = await repo.findByFullPath(warehouse.id, opts.parentFullPath);
			if (!parent) throw new NotFoundError("location", opts.parentFullPath);
			listOpts.parentId = parent.id;
		}
		return repo.listByWarehouse(warehouse.id, listOpts);
	}

	async tree(warehouseCode: string, includeInactive = false): Promise<LocationNode[]> {
		const warehouse = await createWarehouseRepository(this.db).findByCode(warehouseCode);
		if (!warehouse) throw new NotFoundError("warehouse", warehouseCode);
		const repo = createLocationRepository(this.db);
		const all = await repo.listAllByWarehouse(warehouse.id, includeInactive);
		const byId = new Map<number, LocationNode>();
		const roots: LocationNode[] = [];
		for (const loc of all) byId.set(loc.id, { ...loc, children: [] });
		for (const node of byId.values()) {
			if (node.parentLocationId === null) {
				roots.push(node);
			} else {
				const parent = byId.get(node.parentLocationId);
				if (parent) parent.children.push(node);
				else roots.push(node); // orphan fallback; shouldn't happen under normal FK use
			}
		}
		return roots;
	}

	async archive(fullPath: string): Promise<Location> {
		return withTransaction(this.db, async (tx) => {
			const existing = await this.resolveByFullPathInTx(tx, fullPath);
			if (!existing.isActive) return existing;
			await createLocationRepository(tx).setActive(existing.id, false);
			const updated = await createLocationRepository(tx).findById(existing.id);
			if (!updated) throw new Error("failed to reload archived location");
			return updated;
		});
	}

	async unarchive(fullPath: string): Promise<Location> {
		return withTransaction(this.db, async (tx) => {
			const existing = await this.resolveByFullPathInTx(tx, fullPath);
			if (existing.isActive) return existing;
			await createLocationRepository(tx).setActive(existing.id, true);
			const updated = await createLocationRepository(tx).findById(existing.id);
			if (!updated) throw new Error("failed to reload unarchived location");
			return updated;
		});
	}

	async delete(fullPath: string): Promise<void> {
		return withTransaction(this.db, async (tx) => {
			const existing = await this.resolveByFullPathInTx(tx, fullPath);
			const repo = createLocationRepository(tx);
			if (await repo.hasChildren(existing.id)) {
				throw new ConflictError(`location has descendants; delete them first: ${fullPath}`);
			}
			// TODO: Step 10 で stock_levels 参照もチェック（在庫があれば削除拒否）
			await repo.delete(existing.id);
		});
	}

	private async resolveByFullPathInTx(
		tx: Parameters<typeof createLocationRepository>[0],
		fullPath: string,
	): Promise<Location> {
		const segments = splitPath(fullPath);
		if (segments.length < 2) {
			throw new ValidationError(`invalid full path: ${fullPath}`);
		}
		const warehouseCode = segments[0];
		if (!warehouseCode) throw new ValidationError(`invalid full path: ${fullPath}`);
		const warehouse = await createWarehouseRepository(tx).findByCode(warehouseCode);
		if (!warehouse) throw new NotFoundError("warehouse", warehouseCode);
		const loc = await createLocationRepository(tx).findByFullPath(warehouse.id, fullPath);
		if (!loc) throw new NotFoundError("location", fullPath);
		return loc;
	}
}
