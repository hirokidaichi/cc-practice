import { z } from "zod";
import { LocationFullPathSchema } from "../location/schema.js";
import { SkuSchema } from "../variant/schema.js";
import { WarehouseCodeSchema } from "../warehouse/schema.js";

export const MovementTypeSchema = z.enum([
	"inbound",
	"outbound",
	"reserve",
	"release",
	"adjustment",
	"transfer_out",
	"transfer_in",
]);
export type MovementType = z.infer<typeof MovementTypeSchema>;

export const StockLevelSchema = z.object({
	variantId: z.number().int().positive(),
	locationId: z.number().int().positive(),
	onHandQty: z.number().int().nonnegative(),
	reservedQty: z.number().int().nonnegative(),
	availableQty: z.number().int(),
	lastMovementAt: z.string().nullable(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const StockLevelDetailSchema = StockLevelSchema.extend({
	sku: SkuSchema,
	fullPath: z.string(),
	warehouseCode: WarehouseCodeSchema,
});
export type StockLevelDetail = z.infer<typeof StockLevelDetailSchema>;

export const MovementSchema = z.object({
	id: z.number().int().positive(),
	variantId: z.number().int().positive(),
	locationId: z.number().int().positive(),
	movementType: MovementTypeSchema,
	qty: z.number().int(),
	unitCost: z.number().int().nullable(),
	refType: z.string().nullable(),
	refId: z.number().int().nullable(),
	note: z.string().nullable(),
	occurredAt: z.string(),
	createdAt: z.string(),
});
export type Movement = z.infer<typeof MovementSchema>;

export const StockQueryOptsSchema = z.object({
	sku: SkuSchema.optional(),
	warehouseCode: WarehouseCodeSchema.optional(),
	locationFullPath: LocationFullPathSchema.optional(),
	includeZero: z.boolean().default(false),
});
export type StockQueryOpts = z.infer<typeof StockQueryOptsSchema>;

export const MovementQueryOptsSchema = z.object({
	sku: SkuSchema.optional(),
	locationFullPath: LocationFullPathSchema.optional(),
	movementType: MovementTypeSchema.optional(),
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
});
export type MovementQueryOpts = z.infer<typeof MovementQueryOptsSchema>;
