import { z } from "zod";
import { LocationFullPathSchema } from "../location/schema.js";
import { SkuSchema } from "../variant/schema.js";
import { WarehouseCodeSchema } from "../warehouse/schema.js";

export const ReceiptLineInputSchema = z.object({
	sku: SkuSchema,
	locationFullPath: LocationFullPathSchema,
	qty: z.number().int().positive(),
	unitCost: z.number().int().nonnegative(),
});
export type ReceiptLineInput = z.infer<typeof ReceiptLineInputSchema>;

export const ReceiveInputSchema = z.object({
	warehouseCode: WarehouseCodeSchema,
	supplierCode: z.string().min(1).max(64).optional(),
	receivedAt: z.string().optional(),
	note: z.string().optional(),
	lines: z.array(ReceiptLineInputSchema).min(1),
});
export type ReceiveInput = z.infer<typeof ReceiveInputSchema>;

export const GoodsReceiptSchema = z.object({
	id: z.number().int().positive(),
	receiptNumber: z.string(),
	supplierId: z.number().int().positive().nullable(),
	warehouseId: z.number().int().positive(),
	receivedAt: z.string(),
	note: z.string().nullable(),
	createdAt: z.string(),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;

export const GoodsReceiptLineSchema = z.object({
	id: z.number().int().positive(),
	receiptId: z.number().int().positive(),
	variantId: z.number().int().positive(),
	locationId: z.number().int().positive(),
	qty: z.number().int().positive(),
	unitCost: z.number().int().nonnegative(),
});
export type GoodsReceiptLine = z.infer<typeof GoodsReceiptLineSchema>;

export const ReceiveResultSchema = z.object({
	receipt: GoodsReceiptSchema,
	lines: z.array(GoodsReceiptLineSchema),
});
export type ReceiveResult = z.infer<typeof ReceiveResultSchema>;
