import type { DbClient } from "../../shared/db/client.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { createProductRepository } from "./repository.js";
import type {
	CreateProductInput,
	ListProductsOpts,
	Product,
	UpdateProductInput,
} from "./schema.js";

export class ProductService {
	constructor(private readonly db: DbClient) {}

	async create(input: CreateProductInput): Promise<Product> {
		return withTransaction(this.db, async (tx) => {
			const repo = createProductRepository(tx);
			const existing = await repo.findByCode(input.code);
			if (existing) {
				throw new ConflictError(`product code already exists: ${input.code}`, {
					code: input.code,
				});
			}
			const id = await repo.create(input);
			const created = await repo.findById(id);
			if (!created) throw new Error("failed to reload created product");
			return created;
		});
	}

	async findByCode(code: string): Promise<Product | null> {
		const repo = createProductRepository(this.db);
		return repo.findByCode(code);
	}

	async requireByCode(code: string): Promise<Product> {
		const p = await this.findByCode(code);
		if (!p) throw new NotFoundError("product", code);
		return p;
	}

	async list(opts: ListProductsOpts): Promise<{ items: Product[]; total: number }> {
		const repo = createProductRepository(this.db);
		return repo.list(opts);
	}

	async update(code: string, patch: UpdateProductInput): Promise<Product> {
		return withTransaction(this.db, async (tx) => {
			const repo = createProductRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("product", code);
			await repo.update(existing.id, patch);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload updated product");
			return updated;
		});
	}

	async archive(code: string): Promise<Product> {
		return withTransaction(this.db, async (tx) => {
			const repo = createProductRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("product", code);
			if (!existing.isActive) return existing;
			await repo.setActive(existing.id, false);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload archived product");
			return updated;
		});
	}

	async unarchive(code: string): Promise<Product> {
		return withTransaction(this.db, async (tx) => {
			const repo = createProductRepository(tx);
			const existing = await repo.findByCode(code);
			if (!existing) throw new NotFoundError("product", code);
			if (existing.isActive) return existing;
			await repo.setActive(existing.id, true);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload unarchived product");
			return updated;
		});
	}
}
