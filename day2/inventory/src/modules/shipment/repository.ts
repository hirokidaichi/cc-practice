import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type { ListShipmentsOpts, Shipment, ShipmentLine, ShipmentStatus } from "./schema.js";

function toNullableString(v: unknown): string | null {
	return v === null || v === undefined ? null : String(v);
}

function rowToShipment(row: Row): Shipment {
	return {
		id: Number(row.id),
		shipmentNumber: String(row.shipment_number),
		orderId: Number(row.order_id),
		warehouseId: Number(row.warehouse_id),
		carrier: toNullableString(row.carrier),
		trackingNumber: toNullableString(row.tracking_number),
		status: String(row.status) as ShipmentStatus,
		shippedAt: toNullableString(row.shipped_at),
		deliveredAt: toNullableString(row.delivered_at),
		note: toNullableString(row.note),
		createdAt: String(row.created_at),
	};
}

function rowToLine(row: Row): ShipmentLine {
	return {
		id: Number(row.id),
		shipmentId: Number(row.shipment_id),
		orderLineId: Number(row.order_line_id),
		qty: Number(row.qty),
	};
}

export interface CreateShipmentArgs {
	shipmentNumber: string;
	orderId: number;
	warehouseId: number;
	carrier: string | null;
	trackingNumber: string | null;
	status: ShipmentStatus;
	shippedAt: string | null;
	note: string | null;
}

export interface CreateShipmentLineArgs {
	shipmentId: number;
	orderLineId: number;
	qty: number;
}

export interface InsertGlEntryArgs {
	entryDate: string;
	account: "sales" | "cogs" | "inventory" | "discount" | "ar" | "cash";
	debit: number;
	credit: number;
	refType: string | null;
	refId: number | null;
	note: string | null;
}

export function createShipmentRepository(db: DbExecutor) {
	return {
		async create(args: CreateShipmentArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO shipments
				        (shipment_number, order_id, warehouse_id, carrier, tracking_number,
				         status, shipped_at, note)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.shipmentNumber,
					args.orderId,
					args.warehouseId,
					args.carrier,
					args.trackingNumber,
					args.status,
					args.shippedAt,
					args.note,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT shipments did not return id");
			return Number(row.id);
		},

		async createLine(args: CreateShipmentLineArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO shipment_lines (shipment_id, order_line_id, qty)
				      VALUES (?, ?, ?)
				      RETURNING id`,
				args: [args.shipmentId, args.orderLineId, args.qty],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT shipment_lines did not return id");
			return Number(row.id);
		},

		async findById(id: number): Promise<Shipment | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM shipments WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToShipment(row) : null;
		},

		async findByNumber(shipmentNumber: string): Promise<Shipment | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM shipments WHERE shipment_number = ?",
				args: [shipmentNumber],
			});
			const row = rs.rows[0];
			return row ? rowToShipment(row) : null;
		},

		async listLines(shipmentId: number): Promise<ShipmentLine[]> {
			const rs = await db.execute({
				sql: "SELECT * FROM shipment_lines WHERE shipment_id = ? ORDER BY id ASC",
				args: [shipmentId],
			});
			return rs.rows.map(rowToLine);
		},

		async updateStatus(
			id: number,
			status: ShipmentStatus,
			timestampColumn: "shipped_at" | "delivered_at" | null,
			occurredAt: string | null,
		): Promise<void> {
			if (timestampColumn && occurredAt) {
				await db.execute({
					sql: `UPDATE shipments SET status = ?, ${timestampColumn} = ? WHERE id = ?`,
					args: [status, occurredAt, id],
				});
			} else {
				await db.execute({
					sql: "UPDATE shipments SET status = ? WHERE id = ?",
					args: [status, id],
				});
			}
		},

		async list(opts: ListShipmentsOpts): Promise<{ items: Shipment[]; total: number }> {
			const clauses: string[] = [];
			const args: (string | number)[] = [];
			if (opts.orderNumber) {
				clauses.push("order_id = (SELECT id FROM sales_orders WHERE order_number = ?)");
				args.push(opts.orderNumber);
			}
			if (opts.status) {
				clauses.push("status = ?");
				args.push(opts.status);
			}
			const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
			const items = await db.execute({
				sql: `SELECT * FROM shipments ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
				args: [...args, opts.limit, opts.offset],
			});
			const count = await db.execute({
				sql: `SELECT COUNT(*) AS c FROM shipments ${where}`,
				args,
			});
			return {
				items: items.rows.map(rowToShipment),
				total: Number(count.rows[0]?.c ?? 0),
			};
		},

		async insertGlEntry(args: InsertGlEntryArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO gl_entries
				        (entry_date, account, debit, credit, ref_type, ref_id, note)
				      VALUES (?, ?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.entryDate,
					args.account,
					args.debit,
					args.credit,
					args.refType,
					args.refId,
					args.note,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT gl_entries did not return id");
			return Number(row.id);
		},

		async updateAllocationConsumedCost(allocationId: number, consumedCost: number): Promise<void> {
			await db.execute({
				sql: "UPDATE order_line_allocations SET consumed_cost = ? WHERE id = ?",
				args: [consumedCost, allocationId],
			});
		},

		async updateOrderLineCapturedCost(
			orderLineId: number,
			capturedUnitCost: number,
		): Promise<void> {
			await db.execute({
				sql: "UPDATE sales_order_lines SET captured_unit_cost = ? WHERE id = ?",
				args: [capturedUnitCost, orderLineId],
			});
		},
	};
}

export type ShipmentRepository = ReturnType<typeof createShipmentRepository>;
