import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type { Movement, MovementType, StockLevel, StockLevelDetail } from "./schema.js";

function rowToStockLevel(row: Row): StockLevel {
	return {
		variantId: Number(row.variant_id),
		locationId: Number(row.location_id),
		onHandQty: Number(row.on_hand_qty),
		reservedQty: Number(row.reserved_qty),
		availableQty: Number(row.available_qty),
		lastMovementAt:
			row.last_movement_at === null || row.last_movement_at === undefined
				? null
				: String(row.last_movement_at),
	};
}

function rowToStockLevelDetail(row: Row): StockLevelDetail {
	return {
		...rowToStockLevel(row),
		sku: String(row.sku),
		fullPath: String(row.full_path),
		warehouseCode: String(row.warehouse_code),
	};
}

function rowToMovement(row: Row): Movement {
	return {
		id: Number(row.id),
		variantId: Number(row.variant_id),
		locationId: Number(row.location_id),
		movementType: String(row.movement_type) as MovementType,
		qty: Number(row.qty),
		unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
		refType: row.ref_type === null || row.ref_type === undefined ? null : String(row.ref_type),
		refId: row.ref_id === null || row.ref_id === undefined ? null : Number(row.ref_id),
		note: row.note === null || row.note === undefined ? null : String(row.note),
		occurredAt: String(row.occurred_at),
		createdAt: String(row.created_at),
	};
}

export interface AdjustStockArgs {
	variantId: number;
	locationId: number;
	onHandDelta: number;
	reservedDelta: number;
	occurredAt: string;
}

export interface RecordMovementArgs {
	variantId: number;
	locationId: number;
	movementType: MovementType;
	qty: number;
	unitCost?: number;
	refType?: string;
	refId?: number;
	note?: string;
	occurredAt: string;
}

export function createStockRepository(db: DbExecutor) {
	return {
		async findByVariantAndLocation(
			variantId: number,
			locationId: number,
		): Promise<StockLevel | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM stock_levels WHERE variant_id = ? AND location_id = ?",
				args: [variantId, locationId],
			});
			const row = rs.rows[0];
			return row ? rowToStockLevel(row) : null;
		},

		/**
		 * Upsert stock_levels with given deltas. Enforces non-negative constraints via the
		 * DB's CHECK, so callers should guard against over-consumption beforehand when possible.
		 */
		async adjustStock(args: AdjustStockArgs): Promise<StockLevel> {
			await db.execute({
				sql: `INSERT INTO stock_levels (variant_id, location_id, on_hand_qty, reserved_qty, last_movement_at)
				      VALUES (?, ?, ?, ?, ?)
				      ON CONFLICT (variant_id, location_id) DO UPDATE SET
				        on_hand_qty = on_hand_qty + excluded.on_hand_qty,
				        reserved_qty = reserved_qty + excluded.reserved_qty,
				        last_movement_at = excluded.last_movement_at`,
				args: [
					args.variantId,
					args.locationId,
					args.onHandDelta,
					args.reservedDelta,
					args.occurredAt,
				],
			});
			const row = await this.findByVariantAndLocation(args.variantId, args.locationId);
			if (!row) throw new Error("failed to reload adjusted stock level");
			return row;
		},

		async recordMovement(args: RecordMovementArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO inventory_movements
				        (variant_id, location_id, movement_type, qty, unit_cost, ref_type, ref_id, note, occurred_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.variantId,
					args.locationId,
					args.movementType,
					args.qty,
					args.unitCost ?? null,
					args.refType ?? null,
					args.refId ?? null,
					args.note ?? null,
					args.occurredAt,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT inventory_movements did not return id");
			return Number(row.id);
		},

		async listStockDetail(filter: {
			variantId?: number;
			warehouseId?: number;
			locationId?: number;
			includeZero: boolean;
		}): Promise<StockLevelDetail[]> {
			const clauses: string[] = [];
			const args: number[] = [];
			if (filter.variantId !== undefined) {
				clauses.push("sl.variant_id = ?");
				args.push(filter.variantId);
			}
			if (filter.warehouseId !== undefined) {
				clauses.push("l.warehouse_id = ?");
				args.push(filter.warehouseId);
			}
			if (filter.locationId !== undefined) {
				clauses.push("sl.location_id = ?");
				args.push(filter.locationId);
			}
			if (!filter.includeZero) clauses.push("sl.on_hand_qty > 0");
			const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
			const rs = await db.execute({
				sql: `SELECT sl.*,
				             v.sku AS sku,
				             l.full_path AS full_path,
				             w.code AS warehouse_code
				      FROM stock_levels sl
				      JOIN product_variants v ON v.id = sl.variant_id
				      JOIN locations l ON l.id = sl.location_id
				      JOIN warehouses w ON w.id = l.warehouse_id
				      ${where}
				      ORDER BY w.code ASC, l.full_path ASC, v.sku ASC`,
				args,
			});
			return rs.rows.map(rowToStockLevelDetail);
		},

		async listMovements(filter: {
			variantId?: number;
			locationId?: number;
			movementType?: MovementType;
			limit: number;
			offset: number;
		}): Promise<Movement[]> {
			const clauses: string[] = [];
			const args: (number | string)[] = [];
			if (filter.variantId !== undefined) {
				clauses.push("variant_id = ?");
				args.push(filter.variantId);
			}
			if (filter.locationId !== undefined) {
				clauses.push("location_id = ?");
				args.push(filter.locationId);
			}
			if (filter.movementType !== undefined) {
				clauses.push("movement_type = ?");
				args.push(filter.movementType);
			}
			const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
			const rs = await db.execute({
				sql: `SELECT * FROM inventory_movements ${where} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
				args: [...args, filter.limit, filter.offset],
			});
			return rs.rows.map(rowToMovement);
		},
	};
}

export type StockRepository = ReturnType<typeof createStockRepository>;
