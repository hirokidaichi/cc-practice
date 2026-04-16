import { z } from "zod";
import { SkuSchema } from "../variant/schema.js";
import { WarehouseCodeSchema } from "../warehouse/schema.js";

export const CustomerCodeSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "customer code must be alphanumeric with '-' or '_'");

export const OrderStatusSchema = z.enum([
	"pending",
	"confirmed",
	"shipped",
	"delivered",
	"cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderNumberSchema = z.string().min(1).max(64);

export const CreateOrderLineInputSchema = z.object({
	sku: SkuSchema,
	qty: z.number().int().positive(),
	// optional override of variant.unit_price (e.g. for negotiated pricing); falls back to the
	// current variant price if not given.
	unitPrice: z.number().int().nonnegative().optional(),
	lineDiscount: z.number().int().nonnegative().default(0),
});
export type CreateOrderLineInput = z.infer<typeof CreateOrderLineInputSchema>;

export const CreateOrderInputSchema = z.object({
	customerCode: CustomerCodeSchema,
	warehouseCode: WarehouseCodeSchema,
	orderedAt: z.string().optional(),
	note: z.string().optional(),
	lines: z.array(CreateOrderLineInputSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const SalesOrderSchema = z.object({
	id: z.number().int().positive(),
	orderNumber: z.string(),
	customerId: z.number().int().positive(),
	warehouseId: z.number().int().positive(),
	status: OrderStatusSchema,
	subtotalAmount: z.number().int().nonnegative(),
	discountAmount: z.number().int().nonnegative(),
	totalAmount: z.number().int().nonnegative(),
	orderedAt: z.string(),
	confirmedAt: z.string().nullable(),
	shippedAt: z.string().nullable(),
	deliveredAt: z.string().nullable(),
	cancelledAt: z.string().nullable(),
	note: z.string().nullable(),
});
export type SalesOrder = z.infer<typeof SalesOrderSchema>;

export const SalesOrderLineSchema = z.object({
	id: z.number().int().positive(),
	orderId: z.number().int().positive(),
	variantId: z.number().int().positive(),
	qty: z.number().int().positive(),
	unitPrice: z.number().int().nonnegative(),
	lineDiscount: z.number().int().nonnegative(),
	capturedUnitCost: z.number().int().nonnegative().nullable(),
	sortOrder: z.number().int().nonnegative(),
});
export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>;

export const OrderLineAllocationSchema = z.object({
	id: z.number().int().positive(),
	orderLineId: z.number().int().positive(),
	componentVariantId: z.number().int().positive(),
	locationId: z.number().int().positive(),
	allocatedQty: z.number().int().positive(),
	consumedCost: z.number().int().nonnegative().nullable(),
	createdAt: z.string(),
});
export type OrderLineAllocation = z.infer<typeof OrderLineAllocationSchema>;

export const SalesOrderDetailSchema = z.object({
	order: SalesOrderSchema,
	lines: z.array(SalesOrderLineSchema),
	allocations: z.array(OrderLineAllocationSchema),
});
export type SalesOrderDetail = z.infer<typeof SalesOrderDetailSchema>;

export const ListOrdersOptsSchema = z.object({
	status: OrderStatusSchema.optional(),
	customerCode: CustomerCodeSchema.optional(),
	warehouseCode: WarehouseCodeSchema.optional(),
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
});
export type ListOrdersOpts = z.infer<typeof ListOrdersOptsSchema>;
