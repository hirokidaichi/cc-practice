import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type {
	CreateWarehouseInput,
	ListWarehousesOpts,
	UpdateWarehouseInput,
	Warehouse,
} from "./schema.js";

function rowToWarehouse(row: Row): Warehouse {
	return {
		id: Number(row.id),
		code: String(row.code),
		name: String(row.name),
		address: row.address === null || row.address === undefined ? null : String(row.address),
		isActive: Number(row.is_active) === 1,
		createdAt: String(row.created_at),
	};
}

export function createWarehouseRepository(db: DbExecutor) {
	return {
		async create(input: CreateWarehouseInput): Promise<number> {
			const rs = await db.execute({
				sql: "INSERT INTO warehouses (code, name, address) VALUES (?, ?, ?) RETURNING id",
				args: [input.code, input.name, input.address ?? null],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT warehouses did not return id");
			return Number(row.id);
		},

		async findById(id: number): Promise<Warehouse | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM warehouses WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToWarehouse(row) : null;
		},

		async findByCode(code: string): Promise<Warehouse | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM warehouses WHERE code = ?",
				args: [code],
			});
			const row = rs.rows[0];
			return row ? rowToWarehouse(row) : null;
		},

		async list(opts: ListWarehousesOpts): Promise<{ items: Warehouse[]; total: number }> {
			const where = opts.includeInactive ? "" : "WHERE is_active = 1";
			const itemsRs = await db.execute({
				sql: `SELECT * FROM warehouses ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
				args: [opts.limit, opts.offset],
			});
			const countRs = await db.execute({
				sql: `SELECT COUNT(*) AS c FROM warehouses ${where}`,
				args: [],
			});
			return {
				items: itemsRs.rows.map(rowToWarehouse),
				total: Number(countRs.rows[0]?.c ?? 0),
			};
		},

		async update(id: number, patch: UpdateWarehouseInput): Promise<void> {
			const sets: string[] = [];
			const args: (string | number | null)[] = [];
			if (patch.name !== undefined) {
				sets.push("name = ?");
				args.push(patch.name);
			}
			if (patch.address !== undefined) {
				sets.push("address = ?");
				args.push(patch.address);
			}
			if (sets.length === 0) return;
			args.push(id);
			await db.execute({
				sql: `UPDATE warehouses SET ${sets.join(", ")} WHERE id = ?`,
				args,
			});
		},

		async setActive(id: number, active: boolean): Promise<void> {
			await db.execute({
				sql: "UPDATE warehouses SET is_active = ? WHERE id = ?",
				args: [active ? 1 : 0, id],
			});
		},
	};
}

export type WarehouseRepository = ReturnType<typeof createWarehouseRepository>;
