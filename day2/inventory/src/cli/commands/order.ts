import type { Command } from "commander";
import {
	CreateOrderInputSchema,
	ListOrdersOptsSchema,
	OrderNumberSchema,
} from "../../modules/order/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

export function registerOrderCommands(program: Command, ctx: CliContext): void {
	const o = program.command("order").description("sales order commands");

	o.command("create")
		.description("create a new sales order (status=pending). single-line form.")
		.requiredOption("--customer <code>", "customer code")
		.requiredOption("--warehouse <code>", "warehouse to ship from")
		.requiredOption("--sku <sku>", "variant SKU (simple or bundle)")
		.requiredOption("--qty <n>", "quantity", Number)
		.option("--unit-price <yen>", "override unit price", Number)
		.option("--line-discount <yen>", "line discount amount", Number)
		.option("--at <datetime>", "ordered at (YYYY-MM-DD HH:MM:SS)")
		.option("--note <note>", "free-form note")
		.action(async (opts: Record<string, unknown>) => {
			const line: Record<string, unknown> = {
				sku: opts.sku,
				qty: opts.qty,
				lineDiscount: opts.lineDiscount ?? 0,
			};
			if (opts.unitPrice !== undefined) line.unitPrice = opts.unitPrice;
			const input = CreateOrderInputSchema.parse({
				customerCode: opts.customer,
				warehouseCode: opts.warehouse,
				orderedAt: opts.at,
				note: opts.note,
				lines: [line],
			});
			emit(ctx, await ctx.services.order.create(input));
		});

	o.command("confirm")
		.description("confirm a pending order (reserves stock)")
		.argument("<order-number>", "order number")
		.action(async (orderNumber: string) => {
			const parsed = OrderNumberSchema.parse(orderNumber);
			emit(ctx, await ctx.services.order.confirm(parsed));
		});

	o.command("cancel")
		.description("cancel a pending/confirmed order (releases reserves if any)")
		.argument("<order-number>", "order number")
		.action(async (orderNumber: string) => {
			const parsed = OrderNumberSchema.parse(orderNumber);
			emit(ctx, await ctx.services.order.cancel(parsed));
		});

	o.command("show")
		.description("show a sales order with its lines and allocations")
		.argument("<order-number>", "order number")
		.action(async (orderNumber: string) => {
			const parsed = OrderNumberSchema.parse(orderNumber);
			emit(ctx, await ctx.services.order.requireByNumber(parsed));
		});

	o.command("list")
		.description("list sales orders")
		.option("--status <status>", "pending|confirmed|shipped|delivered|cancelled")
		.option("--customer <code>", "filter by customer code")
		.option("--warehouse <code>", "filter by warehouse code")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.action(
			async (opts: {
				status?: string;
				customer?: string;
				warehouse?: string;
				limit: number;
				offset: number;
			}) => {
				const parsed = ListOrdersOptsSchema.parse({
					status: opts.status,
					customerCode: opts.customer,
					warehouseCode: opts.warehouse,
					limit: opts.limit,
					offset: opts.offset,
				});
				const page = await ctx.services.order.list(parsed);
				if (ctx.jsonOutput) {
					emit(ctx, page);
					return;
				}
				emitTable(
					ctx,
					page.items.map((o) => ({
						order_number: o.orderNumber,
						status: o.status,
						total: o.totalAmount,
						ordered_at: o.orderedAt,
					})),
					["order_number", "status", "total", "ordered_at"],
				);
				process.stdout.write(`\n${page.items.length}/${page.total} shown\n`);
			},
		);
}
