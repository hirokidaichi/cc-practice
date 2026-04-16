import { z } from "zod";

export const WarehouseCodeSchema = z
	.string()
	.min(1)
	.max(32)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "warehouse code must be alphanumeric with '-' or '_'");

export const WarehouseSchema = z.object({
	id: z.number().int().positive(),
	code: WarehouseCodeSchema,
	name: z.string().min(1).max(255),
	address: z.string().nullable(),
	isActive: z.boolean(),
	createdAt: z.string(),
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

export const CreateWarehouseInputSchema = z.object({
	code: WarehouseCodeSchema,
	name: z.string().min(1).max(255),
	address: z.string().optional(),
});
export type CreateWarehouseInput = z.infer<typeof CreateWarehouseInputSchema>;

export const UpdateWarehouseInputSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	address: z.string().nullable().optional(),
});
export type UpdateWarehouseInput = z.infer<typeof UpdateWarehouseInputSchema>;

export const ListWarehousesOptsSchema = z.object({
	includeInactive: z.boolean().default(false),
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
});
export type ListWarehousesOpts = z.infer<typeof ListWarehousesOptsSchema>;
