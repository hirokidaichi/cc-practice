import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type { Location, LocationType } from "./schema.js";

function rowToLocation(row: Row): Location {
	return {
		id: Number(row.id),
		warehouseId: Number(row.warehouse_id),
		parentLocationId:
			row.parent_location_id === null || row.parent_location_id === undefined
				? null
				: Number(row.parent_location_id),
		code: String(row.code),
		fullPath: String(row.full_path),
		locationType: String(row.location_type) as LocationType,
		isActive: Number(row.is_active) === 1,
		createdAt: String(row.created_at),
	};
}

export interface LocationCreateArgs {
	warehouseId: number;
	parentLocationId: number | null;
	code: string;
	fullPath: string;
	locationType: LocationType;
}

export function createLocationRepository(db: DbExecutor) {
	return {
		async create(args: LocationCreateArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO locations
				        (warehouse_id, parent_location_id, code, full_path, location_type)
				      VALUES (?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.warehouseId,
					args.parentLocationId,
					args.code,
					args.fullPath,
					args.locationType,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT locations did not return id");
			return Number(row.id);
		},

		async findById(id: number): Promise<Location | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM locations WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToLocation(row) : null;
		},

		async findByFullPath(warehouseId: number, fullPath: string): Promise<Location | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM locations WHERE warehouse_id = ? AND full_path = ?",
				args: [warehouseId, fullPath],
			});
			const row = rs.rows[0];
			return row ? rowToLocation(row) : null;
		},

		async listByWarehouse(
			warehouseId: number,
			opts: { parentId?: number | null; includeInactive: boolean },
		): Promise<Location[]> {
			const clauses: string[] = ["warehouse_id = ?"];
			const args: (number | null)[] = [warehouseId];
			if (opts.parentId !== undefined) {
				if (opts.parentId === null) {
					clauses.push("parent_location_id IS NULL");
				} else {
					clauses.push("parent_location_id = ?");
					args.push(opts.parentId);
				}
			}
			if (!opts.includeInactive) clauses.push("is_active = 1");
			const rs = await db.execute({
				sql: `SELECT * FROM locations WHERE ${clauses.join(" AND ")} ORDER BY full_path ASC`,
				args,
			});
			return rs.rows.map(rowToLocation);
		},

		async listAllByWarehouse(warehouseId: number, includeInactive: boolean): Promise<Location[]> {
			const where = includeInactive
				? "WHERE warehouse_id = ?"
				: "WHERE warehouse_id = ? AND is_active = 1";
			const rs = await db.execute({
				sql: `SELECT * FROM locations ${where} ORDER BY full_path ASC`,
				args: [warehouseId],
			});
			return rs.rows.map(rowToLocation);
		},

		async hasChildren(id: number): Promise<boolean> {
			const rs = await db.execute({
				sql: "SELECT COUNT(*) AS c FROM locations WHERE parent_location_id = ?",
				args: [id],
			});
			return Number(rs.rows[0]?.c ?? 0) > 0;
		},

		async setActive(id: number, active: boolean): Promise<void> {
			await db.execute({
				sql: "UPDATE locations SET is_active = ? WHERE id = ?",
				args: [active ? 1 : 0, id],
			});
		},

		async delete(id: number): Promise<void> {
			await db.execute({
				sql: "DELETE FROM locations WHERE id = ?",
				args: [id],
			});
		},
	};
}

export type LocationRepository = ReturnType<typeof createLocationRepository>;
