import type { DbClient } from "../../shared/db/client.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { createWarehouseRepository } from "./repository.js";
import type {
	CreateWarehouseInput,
	ListWarehousesOpts,
	UpdateWarehouseInput,
	Warehouse,
} from "./schema.js";

export class WarehouseService {
	constructor(private readonly db: DbClient) {}

	async create(input: CreateWarehouseInput): Promise<Warehouse> {
		return withTransaction(this.db, async (tx) => {
			const repo = createWarehouseRepository(tx);
			const existing = await repo.findByCode(input.code);
			if (existing) {
				throw new ConflictError(`warehouse code already exists: ${input.code}`, {
					code: input.code,
				});
			}
			const id = await repo.create(input);
			const created = await repo.findById(id);
			if (!created) throw new Error("failed to reload created warehouse");
			return created;
		});
	}

	async findByCode(code: string): Promise<Warehouse | null> {
		return createWarehouseRepository(this.db).findByCode(code);
	}

	async requireByCode(code: string): Promise<Warehouse> {
		const w = await this.findByCode(code);
		if (!w) throw new NotFoundError("warehouse", code);
		return w;
	}

	async list(opts: ListWarehousesOpts): Promise<{ items: Warehouse[]; total: number }> {
		return createWarehouseRepository(this.db).list(opts);
	}

	async update(code: string, patch: UpdateWarehouseInput): Promise<Warehouse> {
		return withTransaction(this.db, async (tx) => {
			const repo = createWarehouseRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("warehouse", code);
			await repo.update(existing.id, patch);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload updated warehouse");
			return updated;
		});
	}

	async archive(code: string): Promise<Warehouse> {
		return withTransaction(this.db, async (tx) => {
			const repo = createWarehouseRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("warehouse", code);
			if (!existing.isActive) return existing;
			await repo.setActive(existing.id, false);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload archived warehouse");
			return updated;
		});
	}

	async unarchive(code: string): Promise<Warehouse> {
		return withTransaction(this.db, async (tx) => {
			const repo = createWarehouseRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("warehouse", code);
			if (existing.isActive) return existing;
			await repo.setActive(existing.id, true);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload unarchived warehouse");
			return updated;
		});
	}
}
