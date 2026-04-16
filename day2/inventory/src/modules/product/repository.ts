import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type {
	CreateProductInput,
	ListProductsOpts,
	Product,
	UpdateProductInput,
} from "./schema.js";

function toStringOrNull(v: unknown): string | null {
	return v === null || v === undefined ? null : String(v);
}

function toNumberOrNull(v: unknown): number | null {
	return v === null || v === undefined ? null : Number(v);
}

function rowToProduct(row: Row): Product {
	return {
		id: Number(row.id),
		code: String(row.code),
		name: String(row.name),
		description: toStringOrNull(row.description),
		categoryId: toNumberOrNull(row.category_id),
		isActive: Number(row.is_active) === 1,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

export function createProductRepository(db: DbExecutor) {
	return {
		async create(input: CreateProductInput): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO products (code, name, description, category_id)
				      VALUES (?, ?, ?, ?)
				      RETURNING id`,
				args: [input.code, input.name, input.description ?? null, input.categoryId ?? null],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT products did not return id");
			return Number(row.id);
		},

		async findById(id: number): Promise<Product | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM products WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToProduct(row) : null;
		},

		async findByCode(code: string): Promise<Product | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM products WHERE code = ?",
				args: [code],
			});
			const row = rs.rows[0];
			return row ? rowToProduct(row) : null;
		},

		async list(opts: ListProductsOpts): Promise<{ items: Product[]; total: number }> {
			const whereClauses: string[] = [];
			if (!opts.includeInactive) whereClauses.push("is_active = 1");
			const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

			const itemsRs = await db.execute({
				sql: `SELECT * FROM products ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
				args: [opts.limit, opts.offset],
			});
			const countRs = await db.execute({
				sql: `SELECT COUNT(*) AS c FROM products ${where}`,
				args: [],
			});
			const total = Number(countRs.rows[0]?.c ?? 0);
			return { items: itemsRs.rows.map(rowToProduct), total };
		},

		async update(id: number, patch: UpdateProductInput): Promise<void> {
			const sets: string[] = [];
			const args: (string | number | null)[] = [];
			if (patch.name !== undefined) {
				sets.push("name = ?");
				args.push(patch.name);
			}
			if (patch.description !== undefined) {
				sets.push("description = ?");
				args.push(patch.description);
			}
			if (patch.categoryId !== undefined) {
				sets.push("category_id = ?");
				args.push(patch.categoryId);
			}
			if (sets.length === 0) return;
			sets.push("updated_at = datetime('now')");
			args.push(id);
			await db.execute({
				sql: `UPDATE products SET ${sets.join(", ")} WHERE id = ?`,
				args,
			});
		},

		async setActive(id: number, active: boolean): Promise<void> {
			await db.execute({
				sql: "UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
				args: [active ? 1 : 0, id],
			});
		},
	};
}

export type ProductRepository = ReturnType<typeof createProductRepository>;
