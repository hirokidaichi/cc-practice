import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type { GoodsReceipt, GoodsReceiptLine } from "./schema.js";

function rowToReceipt(row: Row): GoodsReceipt {
	return {
		id: Number(row.id),
		receiptNumber: String(row.receipt_number),
		supplierId:
			row.supplier_id === null || row.supplier_id === undefined ? null : Number(row.supplier_id),
		warehouseId: Number(row.warehouse_id),
		receivedAt: String(row.received_at),
		note: row.note === null || row.note === undefined ? null : String(row.note),
		createdAt: String(row.created_at),
	};
}

function rowToReceiptLine(row: Row): GoodsReceiptLine {
	return {
		id: Number(row.id),
		receiptId: Number(row.receipt_id),
		variantId: Number(row.variant_id),
		locationId: Number(row.location_id),
		qty: Number(row.qty),
		unitCost: Number(row.unit_cost),
	};
}

export interface CreateReceiptArgs {
	receiptNumber: string;
	supplierId: number | null;
	warehouseId: number;
	receivedAt: string;
	note: string | null;
}

export interface CreateReceiptLineArgs {
	receiptId: number;
	variantId: number;
	locationId: number;
	qty: number;
	unitCost: number;
}

export function createInboundRepository(db: DbExecutor) {
	return {
		async createReceipt(args: CreateReceiptArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO goods_receipts
				        (receipt_number, supplier_id, warehouse_id, received_at, note)
				      VALUES (?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [args.receiptNumber, args.supplierId, args.warehouseId, args.receivedAt, args.note],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT goods_receipts did not return id");
			return Number(row.id);
		},

		async createReceiptLine(args: CreateReceiptLineArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO goods_receipt_lines
				        (receipt_id, variant_id, location_id, qty, unit_cost)
				      VALUES (?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [args.receiptId, args.variantId, args.locationId, args.qty, args.unitCost],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT goods_receipt_lines did not return id");
			return Number(row.id);
		},

		async findReceiptById(id: number): Promise<GoodsReceipt | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM goods_receipts WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToReceipt(row) : null;
		},

		async findReceiptByNumber(receiptNumber: string): Promise<GoodsReceipt | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM goods_receipts WHERE receipt_number = ?",
				args: [receiptNumber],
			});
			const row = rs.rows[0];
			return row ? rowToReceipt(row) : null;
		},

		async listLines(receiptId: number): Promise<GoodsReceiptLine[]> {
			const rs = await db.execute({
				sql: "SELECT * FROM goods_receipt_lines WHERE receipt_id = ? ORDER BY id ASC",
				args: [receiptId],
			});
			return rs.rows.map(rowToReceiptLine);
		},

		async findSupplierByCode(code: string): Promise<{ id: number } | null> {
			const rs = await db.execute({
				sql: "SELECT id FROM suppliers WHERE code = ?",
				args: [code],
			});
			const row = rs.rows[0];
			return row ? { id: Number(row.id) } : null;
		},
	};
}

export type InboundRepository = ReturnType<typeof createInboundRepository>;
