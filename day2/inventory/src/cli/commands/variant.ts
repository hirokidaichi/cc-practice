import type { Command } from "commander";
import {
	type Attributes,
	AttributesSchema,
	CreateVariantInputSchema,
	ListVariantsOptsSchema,
	SkuSchema,
	UpdateVariantInputSchema,
} from "../../modules/variant/schema.js";
import { ValidationError } from "../../shared/errors/domain-error.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

function parseAttrsFromCli(raw: unknown): Attributes | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "string") {
		throw new ValidationError("--attrs must be a JSON string");
	}
	try {
		const parsed = JSON.parse(raw);
		return AttributesSchema.parse(parsed);
	} catch (err) {
		if (err instanceof Error) {
			throw new ValidationError(`--attrs is not valid JSON: ${err.message}`);
		}
		throw err;
	}
}

export function registerVariantCommands(program: Command, ctx: CliContext): void {
	const v = program.command("variant").description("product variant (SKU) commands");

	v.command("add")
		.description("create a new variant")
		.requiredOption("--product <code>", "parent product code")
		.requiredOption("--sku <sku>", "unique SKU")
		.requiredOption("--price <yen>", "unit price in integer currency units", Number)
		.option("--type <type>", "variant type: simple|bundle", "simple")
		.option("--attrs <json>", 'attributes as JSON object, e.g. \'{"color":"青"}\'')
		.option("--cost <yen>", "standard cost", (val) => Number(val), 0)
		.option("--barcode <code>", "barcode")
		.action(async (opts: Record<string, unknown>) => {
			const input = CreateVariantInputSchema.parse({
				productCode: opts.product,
				sku: opts.sku,
				variantType: opts.type,
				unitPrice: opts.price,
				standardCost: opts.cost,
				attributes: parseAttrsFromCli(opts.attrs),
				barcode: opts.barcode,
			});
			const created = await ctx.services.variant.create(input);
			emit(ctx, created);
		});

	v.command("show")
		.description("show variant details")
		.argument("<sku>", "SKU")
		.action(async (sku: string) => {
			const parsed = SkuSchema.parse(sku);
			const variant = await ctx.services.variant.requireBySku(parsed);
			emit(ctx, variant);
		});

	v.command("list")
		.description("list variants")
		.option("--product <code>", "filter by product code")
		.option("--type <type>", "filter by variant type: simple|bundle")
		.option("--sku-prefix <prefix>", "filter by SKU prefix")
		.option("--all", "include archived variants")
		.option("--limit <n>", "page size", (v) => Number(v), 50)
		.option("--offset <n>", "offset", (v) => Number(v), 0)
		.action(
			async (opts: {
				product?: string;
				type?: string;
				skuPrefix?: string;
				all?: boolean;
				limit: number;
				offset: number;
			}) => {
				const parsed = ListVariantsOptsSchema.parse({
					productCode: opts.product,
					variantType: opts.type,
					skuPrefix: opts.skuPrefix,
					includeInactive: opts.all ?? false,
					limit: opts.limit,
					offset: opts.offset,
				});
				const page = await ctx.services.variant.list(parsed);
				if (ctx.jsonOutput) {
					emit(ctx, page);
					return;
				}
				emitTable(
					ctx,
					page.items.map((x) => ({
						sku: x.sku,
						type: x.variantType,
						price: x.unitPrice,
						cost: x.standardCost,
						active: x.isActive ? "yes" : "no",
					})),
					["sku", "type", "price", "cost", "active"],
				);
				process.stdout.write(`\n${page.items.length}/${page.total} shown\n`);
			},
		);

	v.command("update")
		.description("update variant price/attrs/barcode")
		.argument("<sku>", "SKU")
		.option("--price <yen>", "unit price", Number)
		.option("--cost <yen>", "standard cost", Number)
		.option("--attrs <json>", "attributes JSON (use 'null' to clear)")
		.option("--barcode <code>", "barcode (pass empty to clear)")
		.action(async (sku: string, opts: Record<string, unknown>) => {
			const parsedSku = SkuSchema.parse(sku);
			const patch: Record<string, unknown> = {};
			if (opts.price !== undefined) patch.unitPrice = opts.price;
			if (opts.cost !== undefined) patch.standardCost = opts.cost;
			if (opts.attrs !== undefined) {
				patch.attributes = opts.attrs === "null" ? null : (parseAttrsFromCli(opts.attrs) ?? null);
			}
			if (opts.barcode !== undefined) {
				patch.barcode = opts.barcode === "" ? null : opts.barcode;
			}
			const parsed = UpdateVariantInputSchema.parse(patch);
			const updated = await ctx.services.variant.update(parsedSku, parsed);
			emit(ctx, updated);
		});

	v.command("archive")
		.description("mark variant inactive")
		.argument("<sku>", "SKU")
		.action(async (sku: string) => {
			const parsed = SkuSchema.parse(sku);
			const updated = await ctx.services.variant.archive(parsed);
			emit(ctx, updated);
		});

	v.command("unarchive")
		.description("mark variant active")
		.argument("<sku>", "SKU")
		.action(async (sku: string) => {
			const parsed = SkuSchema.parse(sku);
			const updated = await ctx.services.variant.unarchive(parsed);
			emit(ctx, updated);
		});
}
