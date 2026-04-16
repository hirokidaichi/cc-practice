import type { Command } from "commander";
import {
	AdjustInputSchema,
	PickInputSchema,
	TransferInputSchema,
} from "../../modules/outbound/schema.js";
import type { CliContext } from "../context.js";
import { emit } from "../output.js";

export function registerOutboundCommands(program: Command, ctx: CliContext): void {
	const o = program.command("outbound").description("outbound (pick/adjust/transfer) commands");

	o.command("pick")
		.description("pick inventory from a location (FIFO consume + outbound movement)")
		.requiredOption("--sku <sku>", "variant SKU")
		.requiredOption("--location <full-path>", "source location")
		.requiredOption("--qty <n>", "quantity", Number)
		.option("--at <datetime>", "occurred at (YYYY-MM-DD HH:MM:SS)")
		.option("--note <note>", "free-form note")
		.action(async (opts: Record<string, unknown>) => {
			const input = PickInputSchema.parse({
				sku: opts.sku,
				locationFullPath: opts.location,
				qty: opts.qty,
				occurredAt: opts.at,
				note: opts.note,
			});
			emit(ctx, await ctx.services.outbound.pick(input));
		});

	o.command("adjust")
		.description("record a negative stock adjustment (shrinkage / stocktake loss)")
		.requiredOption("--sku <sku>", "variant SKU")
		.requiredOption("--location <full-path>", "location")
		.requiredOption("--qty <n>", "quantity to remove", Number)
		.option("--at <datetime>", "occurred at (YYYY-MM-DD HH:MM:SS)")
		.option("--note <note>", "reason")
		.action(async (opts: Record<string, unknown>) => {
			const input = AdjustInputSchema.parse({
				sku: opts.sku,
				locationFullPath: opts.location,
				qty: opts.qty,
				occurredAt: opts.at,
				note: opts.note,
			});
			emit(ctx, await ctx.services.outbound.adjustOut(input));
		});

	o.command("transfer")
		.description("transfer stock between locations (auto-detects intra / cross-warehouse)")
		.requiredOption("--sku <sku>", "variant SKU")
		.requiredOption("--from <full-path>", "source location")
		.requiredOption("--to <full-path>", "destination location")
		.requiredOption("--qty <n>", "quantity", Number)
		.option("--at <datetime>", "occurred at (YYYY-MM-DD HH:MM:SS)")
		.option("--note <note>", "free-form note")
		.action(async (opts: Record<string, unknown>) => {
			const input = TransferInputSchema.parse({
				sku: opts.sku,
				fromLocationFullPath: opts.from,
				toLocationFullPath: opts.to,
				qty: opts.qty,
				occurredAt: opts.at,
				note: opts.note,
			});
			emit(ctx, await ctx.services.outbound.transfer(input));
		});
}
