import { z } from "zod";

export const ProductCodeSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "code must be alphanumeric with '-' or '_'");

export const ProductSchema = z.object({
	id: z.number().int().positive(),
	code: ProductCodeSchema,
	name: z.string().min(1).max(255),
	description: z.string().nullable(),
	categoryId: z.number().int().positive().nullable(),
	isActive: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductInputSchema = z.object({
	code: ProductCodeSchema,
	name: z.string().min(1).max(255),
	description: z.string().optional(),
	categoryId: z.number().int().positive().optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	description: z.string().nullable().optional(),
	categoryId: z.number().int().positive().nullable().optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const ListProductsOptsSchema = z.object({
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
	includeInactive: z.boolean().default(false),
});
export type ListProductsOpts = z.infer<typeof ListProductsOptsSchema>;
