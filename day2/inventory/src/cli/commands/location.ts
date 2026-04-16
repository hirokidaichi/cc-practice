import type { Command } from "commander";
import {
	CreateLocationInputSchema,
	ListLocationsOptsSchema,
	LocationFullPathSchema,
	type LocationNode,
} from "../../modules/location/schema.js";
import { WarehouseCodeSchema } from "../../modules/warehouse/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

function renderTree(nodes: LocationNode[], depth: number, out: (line: string) => void): void {
	for (const n of nodes) {
		const indent = "  ".repeat(depth);
		const marker = n.isActive ? "" : " [archived]";
		out(`${indent}- ${n.fullPath} (${n.locationType})${marker}`);
		renderTree(n.children, depth + 1, out);
	}
}

export function registerLocationCommands(program: Command, ctx: CliContext): void {
	const l = program.command("location").description("warehouse location commands");

	l.command("add")
		.description("create a new location (parent must already exist)")
		.requiredOption("--warehouse <code>", "warehouse code")
		.requiredOption("--path <path>", "relative path inside warehouse, e.g. ZONE-A/BIN-3")
		.requiredOption("--type <type>", "zone|aisle|rack|shelf|bin")
		.action(async (opts: { warehouse: string; path: string; type: string }) => {
			const input = CreateLocationInputSchema.parse({
				warehouseCode: opts.warehouse,
				path: opts.path,
				locationType: opts.type,
			});
			emit(ctx, await ctx.services.location.create(input));
		});

	l.command("show")
		.description("show a location by full path (e.g. WH1/ZONE-A/BIN-3)")
		.argument("<full-path>", "location full path")
		.action(async (fullPath: string) => {
			const parsed = LocationFullPathSchema.parse(fullPath);
			emit(ctx, await ctx.services.location.requireByFullPath(parsed));
		});

	l.command("list")
		.description("list locations in a warehouse (optionally filtered by parent)")
		.requiredOption("--warehouse <code>", "warehouse code")
		.option("--parent <full-path>", "limit to children of this location")
		.option("--all", "include archived")
		.action(async (opts: { warehouse: string; parent?: string; all?: boolean }) => {
			const parsed = ListLocationsOptsSchema.parse({
				warehouseCode: opts.warehouse,
				parentFullPath: opts.parent,
				includeInactive: opts.all ?? false,
			});
			const items = await ctx.services.location.list(parsed);
			if (ctx.jsonOutput) {
				emit(ctx, items);
				return;
			}
			emitTable(
				ctx,
				items.map((x) => ({
					full_path: x.fullPath,
					type: x.locationType,
					active: x.isActive ? "yes" : "no",
				})),
				["full_path", "type", "active"],
			);
		});

	l.command("tree")
		.description("render the full location hierarchy of a warehouse")
		.requiredOption("--warehouse <code>", "warehouse code")
		.option("--all", "include archived")
		.action(async (opts: { warehouse: string; all?: boolean }) => {
			const parsedWh = WarehouseCodeSchema.parse(opts.warehouse);
			const tree = await ctx.services.location.tree(parsedWh, opts.all ?? false);
			if (ctx.jsonOutput) {
				emit(ctx, tree);
				return;
			}
			process.stdout.write(`${parsedWh}\n`);
			renderTree(tree, 1, (line) => process.stdout.write(`${line}\n`));
		});

	l.command("archive")
		.description("mark location inactive")
		.argument("<full-path>", "location full path")
		.action(async (fullPath: string) => {
			const parsed = LocationFullPathSchema.parse(fullPath);
			emit(ctx, await ctx.services.location.archive(parsed));
		});

	l.command("unarchive")
		.description("mark location active")
		.argument("<full-path>", "location full path")
		.action(async (fullPath: string) => {
			const parsed = LocationFullPathSchema.parse(fullPath);
			emit(ctx, await ctx.services.location.unarchive(parsed));
		});

	l.command("delete")
		.description("delete a leaf location (must have no descendants or stock)")
		.argument("<full-path>", "location full path")
		.action(async (fullPath: string) => {
			const parsed = LocationFullPathSchema.parse(fullPath);
			await ctx.services.location.delete(parsed);
			process.stdout.write(`deleted: ${parsed}\n`);
		});
}
