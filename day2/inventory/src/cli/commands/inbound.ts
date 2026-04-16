import type { Command } from "commander";
import { ReceiveInputSchema } from "../../modules/inbound/schema.js";
import type { CliContext } from "../context.js";
import { emit } from "../output.js";

export function registerInboundCommands(program: Command, ctx: CliContext): void {
	const i = program.command("inbound").description("goods receipt (inbound) commands");

	i.command("receive")
		.description("record a single-line goods receipt (pushes FIFO cost layer)")
		.requiredOption("--warehouse <code>", "warehouse code")
		.requiredOption("--sku <sku>", "variant SKU (simple only)")
		.requiredOption("--location <full-path>", "target location (WH1/ZONE-A/BIN-3)")
		.requiredOption("--qty <n>", "quantity", Number)
		.requiredOption("--unit-cost <yen>", "unit cost", Number)
		.option("--supplier <code>", "supplier code (must exist if given)")
		.option("--at <datetime>", "received at (YYYY-MM-DD HH:MM:SS, UTC)")
		.option("--note <note>", "free-form note")
		.action(
			async (opts: {
				warehouse: string;
				sku: string;
				location: string;
				qty: number;
				unitCost: number;
				supplier?: string;
				at?: string;
				note?: string;
			}) => {
				const input = ReceiveInputSchema.parse({
					warehouseCode: opts.warehouse,
					supplierCode: opts.supplier,
					receivedAt: opts.at,
					note: opts.note,
					lines: [
						{
							sku: opts.sku,
							locationFullPath: opts.location,
							qty: opts.qty,
							unitCost: opts.unitCost,
						},
					],
				});
				const result = await ctx.services.inbound.receive(input);
				emit(ctx, result);
			},
		);

	i.command("show")
		.description("show a goods receipt by receipt number")
		.argument("<receipt-number>", "receipt number")
		.action(async (receiptNumber: string) => {
			emit(ctx, await ctx.services.inbound.requireReceiptByNumber(receiptNumber));
		});
}
