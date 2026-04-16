import type { Command } from "commander";
import {
	CreateProductInputSchema,
	ListProductsOptsSchema,
	ProductCodeSchema,
	UpdateProductInputSchema,
} from "../../modules/product/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

const AddOptsSchema = CreateProductInputSchema;

const ListOptsSchema = ListProductsOptsSchema;

const UpdateOptsSchema = UpdateProductInputSchema;

export function registerProductCommands(program: Command, ctx: CliContext): void {
	const p = program.command("product").description("product master commands");

	p.command("add")
		.description("create a new product")
		.requiredOption("--code <code>", "product code (unique)")
		.requiredOption("--name <name>", "human-readable name")
		.option("--description <desc>", "description")
		.option("--category-id <id>", "category id", Number)
		.action(async (opts: Record<string, unknown>) => {
			const input = AddOptsSchema.parse({
				code: opts.code,
				name: opts.name,
				description: opts.description,
				categoryId: opts.categoryId,
			});
			const created = await ctx.services.product.create(input);
			emit(ctx, created);
		});

	p.command("show")
		.description("show product details")
		.argument("<code>", "product code")
		.action(async (code: string) => {
			const parsed = ProductCodeSchema.parse(code);
			const product = await ctx.services.product.requireByCode(parsed);
			emit(ctx, product);
		});

	p.command("list")
		.description("list products")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.option("--all", "include archived products")
		.action(async (opts: { limit: number; offset: number; all?: boolean }) => {
			const parsed = ListOptsSchema.parse({
				limit: opts.limit,
				offset: opts.offset,
				includeInactive: opts.all ?? false,
			});
			const page = await ctx.services.product.list(parsed);
			if (ctx.jsonOutput) {
				emit(ctx, page);
				return;
			}
			emitTable(
				ctx,
				page.items.map((p) => ({
					code: p.code,
					name: p.name,
					active: p.isActive ? "yes" : "no",
					updated: p.updatedAt,
				})),
				["code", "name", "active", "updated"],
			);
			process.stdout.write(`\n${page.items.length}/${page.total} shown\n`);
		});

	p.command("update")
		.description("update product fields")
		.argument("<code>", "product code")
		.option("--name <name>", "new name")
		.option("--description <desc>", "new description")
		.option("--category-id <id>", "new category id", Number)
		.action(async (code: string, opts: Record<string, unknown>) => {
			const parsedCode = ProductCodeSchema.parse(code);
			const patch = UpdateOptsSchema.parse({
				name: opts.name,
				description: opts.description,
				categoryId: opts.categoryId,
			});
			const updated = await ctx.services.product.update(parsedCode, patch);
			emit(ctx, updated);
		});

	p.command("archive")
		.description("mark product inactive")
		.argument("<code>", "product code")
		.action(async (code: string) => {
			const parsed = ProductCodeSchema.parse(code);
			const updated = await ctx.services.product.archive(parsed);
			emit(ctx, updated);
		});

	p.command("unarchive")
		.description("mark product active")
		.argument("<code>", "product code")
		.action(async (code: string) => {
			const parsed = ProductCodeSchema.parse(code);
			const updated = await ctx.services.product.unarchive(parsed);
			emit(ctx, updated);
		});
}
