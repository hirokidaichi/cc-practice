import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type {
	ListOrdersOpts,
	OrderLineAllocation,
	OrderStatus,
	SalesOrder,
	SalesOrderLine,
} from "./schema.js";

function toNullableString(v: unknown): string | null {
	return v === null || v === undefined ? null : String(v);
}

function toNullableNumber(v: unknown): number | null {
	return v === null || v === undefined ? null : Number(v);
}

function rowToOrder(row: Row): SalesOrder {
	return {
		id: Number(row.id),
		orderNumber: String(row.order_number),
		customerId: Number(row.customer_id),
		warehouseId: Number(row.warehouse_id),
		status: String(row.status) as OrderStatus,
		subtotalAmount: Number(row.subtotal_amount),
		discountAmount: Number(row.discount_amount),
		totalAmount: Number(row.total_amount),
		orderedAt: String(row.ordered_at),
		confirmedAt: toNullableString(row.confirmed_at),
		shippedAt: toNullableString(row.shipped_at),
		deliveredAt: toNullableString(row.delivered_at),
		cancelledAt: toNullableString(row.cancelled_at),
		note: toNullableString(row.note),
	};
}

function rowToLine(row: Row): SalesOrderLine {
	return {
		id: Number(row.id),
		orderId: Number(row.order_id),
		variantId: Number(row.variant_id),
		qty: Number(row.qty),
		unitPrice: Number(row.unit_price),
		lineDiscount: Number(row.line_discount),
		capturedUnitCost: toNullableNumber(row.captured_unit_cost),
		sortOrder: Number(row.sort_order),
	};
}

function rowToAllocation(row: Row): OrderLineAllocation {
	return {
		id: Number(row.id),
		orderLineId: Number(row.order_line_id),
		componentVariantId: Number(row.component_variant_id),
		locationId: Number(row.location_id),
		allocatedQty: Number(row.allocated_qty),
		consumedCost: toNullableNumber(row.consumed_cost),
		createdAt: String(row.created_at),
	};
}

export interface CreateOrderHeaderArgs {
	orderNumber: string;
	customerId: number;
	warehouseId: number;
	status: OrderStatus;
	subtotalAmount: number;
	discountAmount: number;
	totalAmount: number;
	orderedAt: string;
	note: string | null;
}

export interface CreateOrderLineArgs {
	orderId: number;
	variantId: number;
	qty: number;
	unitPrice: number;
	lineDiscount: number;
	sortOrder: number;
}

export interface CreateAllocationArgs {
	orderLineId: number;
	componentVariantId: number;
	locationId: number;
	allocatedQty: number;
}

export function createOrderRepository(db: DbExecutor) {
	return {
		async createOrder(args: CreateOrderHeaderArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO sales_orders
				        (order_number, customer_id, warehouse_id, status,
				         subtotal_amount, discount_amount, total_amount,
				         ordered_at, note)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.orderNumber,
					args.customerId,
					args.warehouseId,
					args.status,
					args.subtotalAmount,
					args.discountAmount,
					args.totalAmount,
					args.orderedAt,
					args.note,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT sales_orders did not return id");
			return Number(row.id);
		},

		async createLine(args: CreateOrderLineArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO sales_order_lines
				        (order_id, variant_id, qty, unit_price, line_discount, sort_order)
				      VALUES (?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					args.orderId,
					args.variantId,
					args.qty,
					args.unitPrice,
					args.lineDiscount,
					args.sortOrder,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT sales_order_lines did not return id");
			return Number(row.id);
		},

		async createAllocation(args: CreateAllocationArgs): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO order_line_allocations
				        (order_line_id, component_variant_id, location_id, allocated_qty)
				      VALUES (?, ?, ?, ?)
				      RETURNING id`,
				args: [args.orderLineId, args.componentVariantId, args.locationId, args.allocatedQty],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT order_line_allocations did not return id");
			return Number(row.id);
		},

		async updateStatus(
			id: number,
			status: OrderStatus,
			timestampColumn: "confirmed_at" | "shipped_at" | "delivered_at" | "cancelled_at",
			occurredAt: string,
		): Promise<void> {
			await db.execute({
				sql: `UPDATE sales_orders SET status = ?, ${timestampColumn} = ? WHERE id = ?`,
				args: [status, occurredAt, id],
			});
		},

		async findById(id: number): Promise<SalesOrder | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM sales_orders WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToOrder(row) : null;
		},

		async findByNumber(orderNumber: string): Promise<SalesOrder | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM sales_orders WHERE order_number = ?",
				args: [orderNumber],
			});
			const row = rs.rows[0];
			return row ? rowToOrder(row) : null;
		},

		async listLines(orderId: number): Promise<SalesOrderLine[]> {
			const rs = await db.execute({
				sql: "SELECT * FROM sales_order_lines WHERE order_id = ? ORDER BY sort_order ASC, id ASC",
				args: [orderId],
			});
			return rs.rows.map(rowToLine);
		},

		async listAllocationsByOrder(orderId: number): Promise<OrderLineAllocation[]> {
			const rs = await db.execute({
				sql: `SELECT a.*
				      FROM order_line_allocations a
				      JOIN sales_order_lines l ON l.id = a.order_line_id
				      WHERE l.order_id = ?
				      ORDER BY a.id ASC`,
				args: [orderId],
			});
			return rs.rows.map(rowToAllocation);
		},

		async listAllocationsByLine(lineId: number): Promise<OrderLineAllocation[]> {
			const rs = await db.execute({
				sql: "SELECT * FROM order_line_allocations WHERE order_line_id = ? ORDER BY id ASC",
				args: [lineId],
			});
			return rs.rows.map(rowToAllocation);
		},

		async deleteAllocationsByOrder(orderId: number): Promise<void> {
			await db.execute({
				sql: `DELETE FROM order_line_allocations
				      WHERE order_line_id IN (SELECT id FROM sales_order_lines WHERE order_id = ?)`,
				args: [orderId],
			});
		},

		async list(opts: ListOrdersOpts): Promise<{ items: SalesOrder[]; total: number }> {
			const clauses: string[] = [];
			const args: (string | number)[] = [];
			if (opts.status) {
				clauses.push("status = ?");
				args.push(opts.status);
			}
			if (opts.customerCode) {
				clauses.push("customer_id = (SELECT id FROM customers WHERE code = ?)");
				args.push(opts.customerCode);
			}
			if (opts.warehouseCode) {
				clauses.push("warehouse_id = (SELECT id FROM warehouses WHERE code = ?)");
				args.push(opts.warehouseCode);
			}
			const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
			const items = await db.execute({
				sql: `SELECT * FROM sales_orders ${where} ORDER BY ordered_at DESC, id DESC LIMIT ? OFFSET ?`,
				args: [...args, opts.limit, opts.offset],
			});
			const count = await db.execute({
				sql: `SELECT COUNT(*) AS c FROM sales_orders ${where}`,
				args,
			});
			return {
				items: items.rows.map(rowToOrder),
				total: Number(count.rows[0]?.c ?? 0),
			};
		},

		async findCustomerByCode(code: string): Promise<{ id: number } | null> {
			const rs = await db.execute({
				sql: "SELECT id FROM customers WHERE code = ?",
				args: [code],
			});
			const row = rs.rows[0];
			return row ? { id: Number(row.id) } : null;
		},

		/** Returns (location_id, available_qty) ordered by available_qty DESC for a component
		 * within a given warehouse. Excludes zero rows. */
		async listComponentAvailability(
			componentVariantId: number,
			warehouseId: number,
		): Promise<{ locationId: number; availableQty: number }[]> {
			const rs = await db.execute({
				sql: `SELECT sl.location_id, sl.available_qty
				      FROM stock_levels sl
				      JOIN locations l ON l.id = sl.location_id
				      WHERE sl.variant_id = ? AND l.warehouse_id = ? AND sl.available_qty > 0
				      ORDER BY sl.available_qty DESC, sl.location_id ASC`,
				args: [componentVariantId, warehouseId],
			});
			return rs.rows.map((r) => ({
				locationId: Number(r.location_id),
				availableQty: Number(r.available_qty),
			}));
		},
	};
}

export type OrderRepository = ReturnType<typeof createOrderRepository>;
