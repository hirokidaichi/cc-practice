import type { Command } from "commander";
import { MovementQueryOptsSchema, StockQueryOptsSchema } from "../../modules/stock/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

export function registerStockCommands(program: Command, ctx: CliContext): void {
	const s = program.command("stock").description("stock inspection commands");

	s.command("list")
		.description("list stock levels (variant x location)")
		.option("--sku <sku>", "filter by SKU")
		.option("--warehouse <code>", "filter by warehouse")
		.option("--location <full-path>", "filter by exact location")
		.option("--include-zero", "include stock rows where on_hand = 0")
		.action(
			async (opts: {
				sku?: string;
				warehouse?: string;
				location?: string;
				includeZero?: boolean;
			}) => {
				const parsed = StockQueryOptsSchema.parse({
					sku: opts.sku,
					warehouseCode: opts.warehouse,
					locationFullPath: opts.location,
					includeZero: opts.includeZero ?? false,
				});
				const rows = await ctx.services.stock.query(parsed);
				if (ctx.jsonOutput) {
					emit(ctx, rows);
					return;
				}
				emitTable(
					ctx,
					rows.map((r) => ({
						sku: r.sku,
						location: r.fullPath,
						on_hand: r.onHandQty,
						reserved: r.reservedQty,
						available: r.availableQty,
					})),
					["sku", "location", "on_hand", "reserved", "available"],
				);
			},
		);

	s.command("movements")
		.description("list inventory movements (append-only history)")
		.option("--sku <sku>", "filter by SKU")
		.option("--location <full-path>", "filter by location")
		.option("--type <type>", "filter by movement type")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.action(
			async (opts: {
				sku?: string;
				location?: string;
				type?: string;
				limit: number;
				offset: number;
			}) => {
				const parsed = MovementQueryOptsSchema.parse({
					sku: opts.sku,
					locationFullPath: opts.location,
					movementType: opts.type,
					limit: opts.limit,
					offset: opts.offset,
				});
				const rows = await ctx.services.stock.listMovements(parsed);
				if (ctx.jsonOutput) {
					emit(ctx, rows);
					return;
				}
				emitTable(
					ctx,
					rows.map((r) => ({
						occurred_at: r.occurredAt,
						type: r.movementType,
						variant_id: r.variantId,
						location_id: r.locationId,
						qty: r.qty,
						unit_cost: r.unitCost ?? "",
						ref: `${r.refType ?? ""}:${r.refId ?? ""}`,
					})),
					["occurred_at", "type", "variant_id", "location_id", "qty", "unit_cost", "ref"],
				);
			},
		);
}
