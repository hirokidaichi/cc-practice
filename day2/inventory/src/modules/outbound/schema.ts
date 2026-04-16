import { z } from "zod";
import { LocationFullPathSchema } from "../location/schema.js";
import { SkuSchema } from "../variant/schema.js";

export const PickInputSchema = z.object({
	sku: SkuSchema,
	locationFullPath: LocationFullPathSchema,
	qty: z.number().int().positive(),
	occurredAt: z.string().optional(),
	note: z.string().optional(),
	refType: z.string().optional(),
	refId: z.number().int().positive().optional(),
});
export type PickInput = z.infer<typeof PickInputSchema>;

export const AdjustInputSchema = z.object({
	sku: SkuSchema,
	locationFullPath: LocationFullPathSchema,
	qty: z.number().int().positive(),
	occurredAt: z.string().optional(),
	note: z.string().optional(),
});
export type AdjustInput = z.infer<typeof AdjustInputSchema>;

export const TransferInputSchema = z.object({
	sku: SkuSchema,
	fromLocationFullPath: LocationFullPathSchema,
	toLocationFullPath: LocationFullPathSchema,
	qty: z.number().int().positive(),
	occurredAt: z.string().optional(),
	note: z.string().optional(),
});
export type TransferInput = z.infer<typeof TransferInputSchema>;

export interface FifoConsumptionSummary {
	layerId: number;
	consumedQty: number;
	unitCost: number;
}

export interface PickResult {
	variantId: number;
	locationId: number;
	qty: number;
	totalCost: number;
	weightedAvgCost: number;
	consumptions: FifoConsumptionSummary[];
	movementId: number;
}

export interface TransferResult {
	variantId: number;
	fromLocationId: number;
	toLocationId: number;
	qty: number;
	crossWarehouse: boolean;
	// only populated when crossWarehouse is true
	weightedAvgCost?: number;
	totalCost?: number;
	consumptions?: FifoConsumptionSummary[];
	movementOutId: number;
	movementInId: number;
}
