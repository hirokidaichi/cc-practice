import { z } from "zod";

export const ShipmentStatusSchema = z.enum([
	"prepared",
	"shipped",
	"in_transit",
	"delivered",
	"returned",
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const ShipInputSchema = z.object({
	orderNumber: z.string().min(1),
	carrier: z.string().min(1).max(128).optional(),
	trackingNumber: z.string().min(1).max(128).optional(),
	shippedAt: z.string().optional(),
	note: z.string().optional(),
});
export type ShipInput = z.infer<typeof ShipInputSchema>;

export const ShipmentSchema = z.object({
	id: z.number().int().positive(),
	shipmentNumber: z.string(),
	orderId: z.number().int().positive(),
	warehouseId: z.number().int().positive(),
	carrier: z.string().nullable(),
	trackingNumber: z.string().nullable(),
	status: ShipmentStatusSchema,
	shippedAt: z.string().nullable(),
	deliveredAt: z.string().nullable(),
	note: z.string().nullable(),
	createdAt: z.string(),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const ShipmentLineSchema = z.object({
	id: z.number().int().positive(),
	shipmentId: z.number().int().positive(),
	orderLineId: z.number().int().positive(),
	qty: z.number().int().positive(),
});
export type ShipmentLine = z.infer<typeof ShipmentLineSchema>;

export const ShipmentDetailSchema = z.object({
	shipment: ShipmentSchema,
	lines: z.array(ShipmentLineSchema),
	totalCost: z.number().int().nonnegative(),
	totalRevenue: z.number().int().nonnegative(),
});
export type ShipmentDetail = z.infer<typeof ShipmentDetailSchema>;

export const ListShipmentsOptsSchema = z.object({
	orderNumber: z.string().min(1).optional(),
	status: ShipmentStatusSchema.optional(),
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
});
export type ListShipmentsOpts = z.infer<typeof ListShipmentsOptsSchema>;
