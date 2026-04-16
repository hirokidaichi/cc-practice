import { z } from "zod";
import { ProductCodeSchema } from "../product/schema.js";

export const SkuSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "sku must be alphanumeric with '.', '-' or '_'");

export const VariantTypeSchema = z.enum(["simple", "bundle"]);
export type VariantType = z.infer<typeof VariantTypeSchema>;

export const AttributesSchema = z.record(
	z.string(),
	z.union([z.string(), z.number(), z.boolean()]),
);
export type Attributes = z.infer<typeof AttributesSchema>;

export const VariantSchema = z.object({
	id: z.number().int().positive(),
	productId: z.number().int().positive(),
	sku: SkuSchema,
	variantType: VariantTypeSchema,
	attributes: AttributesSchema.nullable(),
	unitPrice: z.number().int().nonnegative(),
	standardCost: z.number().int().nonnegative(),
	barcode: z.string().nullable(),
	isActive: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const CreateVariantInputSchema = z.object({
	productCode: ProductCodeSchema,
	sku: SkuSchema,
	variantType: VariantTypeSchema.default("simple"),
	attributes: AttributesSchema.optional(),
	unitPrice: z.number().int().nonnegative(),
	standardCost: z.number().int().nonnegative().default(0),
	barcode: z.string().min(1).max(255).optional(),
});
export type CreateVariantInput = z.infer<typeof CreateVariantInputSchema>;

export const UpdateVariantInputSchema = z.object({
	unitPrice: z.number().int().nonnegative().optional(),
	standardCost: z.number().int().nonnegative().optional(),
	attributes: AttributesSchema.nullable().optional(),
	barcode: z.string().nullable().optional(),
});
export type UpdateVariantInput = z.infer<typeof UpdateVariantInputSchema>;

export const ListVariantsOptsSchema = z.object({
	productCode: ProductCodeSchema.optional(),
	skuPrefix: z.string().min(1).max(100).optional(),
	variantType: VariantTypeSchema.optional(),
	includeInactive: z.boolean().default(false),
	limit: z.number().int().positive().max(1000).default(50),
	offset: z.number().int().nonnegative().default(0),
});
export type ListVariantsOpts = z.infer<typeof ListVariantsOptsSchema>;

export const BundleComponentSchema = z.object({
	bundleVariantId: z.number().int().positive(),
	componentVariantId: z.number().int().positive(),
	qty: z.number().int().positive(),
	sortOrder: z.number().int().nonnegative(),
});
export type BundleComponent = z.infer<typeof BundleComponentSchema>;

export const BundleComponentDetailSchema = BundleComponentSchema.extend({
	componentSku: SkuSchema,
	componentName: z.string(),
});
export type BundleComponentDetail = z.infer<typeof BundleComponentDetailSchema>;

export const ExpandedLineSchema = z.object({
	variantId: z.number().int().positive(),
	sku: SkuSchema,
	perBundleQty: z.number().int().positive(),
	totalRequiredQty: z.number().int().positive(),
});
export type ExpandedLine = z.infer<typeof ExpandedLineSchema>;
