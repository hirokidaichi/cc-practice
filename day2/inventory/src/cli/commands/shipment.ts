import type { Command } from "commander";
import { ListShipmentsOptsSchema, ShipInputSchema } from "../../modules/shipment/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

export function registerShipmentCommands(program: Command, ctx: CliContext): void {
	const s = program.command("shipment").description("shipment commands");

	s.command("create")
		.description("create a shipment for a confirmed order (consumes FIFO + records GL)")
		.requiredOption("--order <number>", "sales order number (must be in status 'confirmed')")
		.option("--carrier <name>", "carrier name")
		.option("--tracking <no>", "tracking number (globally unique)")
		.option("--at <datetime>", "shipped at (YYYY-MM-DD HH:MM:SS)")
		.option("--note <note>", "free-form note")
		.action(async (opts: Record<string, unknown>) => {
			const input = ShipInputSchema.parse({
				orderNumber: opts.order,
				carrier: opts.carrier,
				trackingNumber: opts.tracking,
				shippedAt: opts.at,
				note: opts.note,
			});
			emit(ctx, await ctx.services.shipment.ship(input));
		});

	s.command("show")
		.description("show a shipment by number")
		.argument("<shipment-number>", "shipment number")
		.action(async (num: string) => {
			emit(ctx, await ctx.services.shipment.requireByNumber(num));
		});

	s.command("list")
		.description("list shipments")
		.option("--order <number>", "filter by order number")
		.option("--status <status>", "prepared|shipped|in_transit|delivered|returned")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.action(async (opts: { order?: string; status?: string; limit: number; offset: number }) => {
			const parsed = ListShipmentsOptsSchema.parse({
				orderNumber: opts.order,
				status: opts.status,
				limit: opts.limit,
				offset: opts.offset,
			});
			const page = await ctx.services.shipment.list(parsed);
			if (ctx.jsonOutput) {
				emit(ctx, page);
				return;
			}
			emitTable(
				ctx,
				page.items.map((x) => ({
					shipment_number: x.shipmentNumber,
					status: x.status,
					tracking: x.trackingNumber ?? "",
					carrier: x.carrier ?? "",
					shipped_at: x.shippedAt ?? "",
					delivered_at: x.deliveredAt ?? "",
				})),
				["shipment_number", "status", "tracking", "carrier", "shipped_at", "delivered_at"],
			);
		});

	s.command("deliver")
		.description("mark a shipment as delivered (also flips the order to delivered)")
		.argument("<shipment-number>", "shipment number")
		.option("--at <datetime>", "delivered at (YYYY-MM-DD HH:MM:SS)")
		.action(async (num: string, opts: { at?: string }) => {
			emit(ctx, await ctx.services.shipment.markDelivered(num, opts.at));
		});
}
