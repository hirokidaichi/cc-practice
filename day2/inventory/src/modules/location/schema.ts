import { z } from "zod";
import { WarehouseCodeSchema } from "../warehouse/schema.js";

export const LocationSegmentSchema = z
	.string()
	.min(1)
	.max(32)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "segment must be alphanumeric with '-' or '_'");

export const LocationTypeSchema = z.enum(["zone", "aisle", "rack", "shelf", "bin"]);
export type LocationType = z.infer<typeof LocationTypeSchema>;

export const LocationRelativePathSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/, "path must be slash-separated segments");

export const LocationFullPathSchema = LocationRelativePathSchema;

export const LocationSchema = z.object({
	id: z.number().int().positive(),
	warehouseId: z.number().int().positive(),
	parentLocationId: z.number().int().positive().nullable(),
	code: LocationSegmentSchema,
	fullPath: z.string(),
	locationType: LocationTypeSchema,
	isActive: z.boolean(),
	createdAt: z.string(),
});
export type Location = z.infer<typeof LocationSchema>;

export const CreateLocationInputSchema = z.object({
	warehouseCode: WarehouseCodeSchema,
	path: LocationRelativePathSchema,
	locationType: LocationTypeSchema,
});
export type CreateLocationInput = z.infer<typeof CreateLocationInputSchema>;

export const ListLocationsOptsSchema = z.object({
	warehouseCode: WarehouseCodeSchema,
	parentFullPath: LocationFullPathSchema.optional(),
	includeInactive: z.boolean().default(false),
});
export type ListLocationsOpts = z.infer<typeof ListLocationsOptsSchema>;

export interface LocationNode extends Location {
	children: LocationNode[];
}
