import type { Command } from "commander";
import {
	CreateWarehouseInputSchema,
	ListWarehousesOptsSchema,
	UpdateWarehouseInputSchema,
	WarehouseCodeSchema,
} from "../../modules/warehouse/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

export function registerWarehouseCommands(program: Command, ctx: CliContext): void {
	const w = program.command("warehouse").description("warehouse master commands");

	w.command("add")
		.description("create a new warehouse")
		.requiredOption("--code <code>", "warehouse code")
		.requiredOption("--name <name>", "human-readable name")
		.option("--address <addr>", "address")
		.action(async (opts: Record<string, unknown>) => {
			const input = CreateWarehouseInputSchema.parse({
				code: opts.code,
				name: opts.name,
				address: opts.address,
			});
			emit(ctx, await ctx.services.warehouse.create(input));
		});

	w.command("show")
		.description("show warehouse details")
		.argument("<code>", "warehouse code")
		.action(async (code: string) => {
			const parsed = WarehouseCodeSchema.parse(code);
			emit(ctx, await ctx.services.warehouse.requireByCode(parsed));
		});

	w.command("list")
		.description("list warehouses")
		.option("--all", "include archived warehouses")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.action(async (opts: { all?: boolean; limit: number; offset: number }) => {
			const parsed = ListWarehousesOptsSchema.parse({
				includeInactive: opts.all ?? false,
				limit: opts.limit,
				offset: opts.offset,
			});
			const page = await ctx.services.warehouse.list(parsed);
			if (ctx.jsonOutput) {
				emit(ctx, page);
				return;
			}
			emitTable(
				ctx,
				page.items.map((x) => ({
					code: x.code,
					name: x.name,
					address: x.address ?? "",
					active: x.isActive ? "yes" : "no",
				})),
				["code", "name", "address", "active"],
			);
			process.stdout.write(`\n${page.items.length}/${page.total} shown\n`);
		});

	w.command("update")
		.description("update warehouse")
		.argument("<code>", "warehouse code")
		.option("--name <name>", "new name")
		.option("--address <addr>", "new address (empty to clear)")
		.action(async (code: string, opts: Record<string, unknown>) => {
			const parsedCode = WarehouseCodeSchema.parse(code);
			const patch: Record<string, unknown> = {};
			if (opts.name !== undefined) patch.name = opts.name;
			if (opts.address !== undefined) patch.address = opts.address === "" ? null : opts.address;
			const parsed = UpdateWarehouseInputSchema.parse(patch);
			emit(ctx, await ctx.services.warehouse.update(parsedCode, parsed));
		});

	w.command("archive")
		.description("mark warehouse inactive")
		.argument("<code>", "warehouse code")
		.action(async (code: string) => {
			const parsed = WarehouseCodeSchema.parse(code);
			emit(ctx, await ctx.services.warehouse.archive(parsed));
		});

	w.command("unarchive")
		.description("mark warehouse active")
		.argument("<code>", "warehouse code")
		.action(async (code: string) => {
			const parsed = WarehouseCodeSchema.parse(code);
			emit(ctx, await ctx.services.warehouse.unarchive(parsed));
		});
}
