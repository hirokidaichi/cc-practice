import type { Command } from "commander";
import { z } from "zod";
import { SkuSchema } from "../../modules/variant/schema.js";
import type { CliContext } from "../context.js";
import { emit, emitTable } from "../output.js";

const DefineInputSchema = z.object({
	bundleSku: SkuSchema,
	componentSku: SkuSchema,
	qty: z.number().int().positive(),
});

const RemoveInputSchema = z.object({
	bundleSku: SkuSchema,
	componentSku: SkuSchema,
});

const ExpandInputSchema = z.object({
	sku: SkuSchema,
	qty: z.number().int().positive(),
});

export function registerBundleCommands(program: Command, ctx: CliContext): void {
	const b = program.command("bundle").description("bundle composition commands");

	b.command("define")
		.description("add or update a component in a bundle")
		.requiredOption("--sku <bundle-sku>", "bundle variant SKU")
		.requiredOption("--component <component-sku>", "simple component SKU")
		.requiredOption("--qty <n>", "required quantity per bundle", Number)
		.action(async (opts: { sku: string; component: string; qty: number }) => {
			const input = DefineInputSchema.parse({
				bundleSku: opts.sku,
				componentSku: opts.component,
				qty: opts.qty,
			});
			const components = await ctx.services.variant.defineBundleComponent(input);
			emit(ctx, components);
		});

	b.command("show")
		.description("show the components of a bundle")
		.argument("<bundle-sku>", "bundle SKU")
		.action(async (sku: string) => {
			const parsed = SkuSchema.parse(sku);
			const components = await ctx.services.variant.listBundleComponents(parsed);
			if (ctx.jsonOutput) {
				emit(ctx, components);
				return;
			}
			emitTable(
				ctx,
				components.map((c) => ({
					component_sku: c.componentSku,
					name: c.componentName,
					qty: c.qty,
				})),
				["component_sku", "name", "qty"],
			);
		});

	b.command("unset")
		.description("remove a component from a bundle")
		.requiredOption("--sku <bundle-sku>", "bundle variant SKU")
		.requiredOption("--component <component-sku>", "component SKU to remove")
		.action(async (opts: { sku: string; component: string }) => {
			const input = RemoveInputSchema.parse({
				bundleSku: opts.sku,
				componentSku: opts.component,
			});
			const components = await ctx.services.variant.removeBundleComponent(input);
			emit(ctx, components);
		});

	b.command("expand")
		.description("preview how a bundle expands into components for a given quantity")
		.requiredOption("--sku <sku>", "variant SKU (simple or bundle)")
		.requiredOption("--qty <n>", "quantity", Number)
		.action(async (opts: { sku: string; qty: number }) => {
			const input = ExpandInputSchema.parse({ sku: opts.sku, qty: opts.qty });
			const variant = await ctx.services.variant.requireBySku(input.sku);
			const expanded = await ctx.services.variant.expandBundle(variant.id, input.qty);
			emit(ctx, expanded);
		});
}
