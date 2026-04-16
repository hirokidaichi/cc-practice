import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { ProductService } from "../product/service.js";
import { VariantService } from "./service.js";

describe("VariantService", () => {
	let ctx: TestDb;
	let productSvc: ProductService;
	let svc: VariantService;

	beforeEach(async () => {
		ctx = await createTestDb();
		productSvc = new ProductService(ctx.db);
		svc = new VariantService(ctx.db);
		await productSvc.create({ code: "PRD-TEE", name: "Tシャツ" });
		await productSvc.create({ code: "PRD-MUG", name: "マグ" });
		await productSvc.create({ code: "PRD-GIFT", name: "ギフトセット" });
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a simple variant and fetches by sku", async () => {
		const created = await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-BLUE-L",
			variantType: "simple",
			unitPrice: 2000,
			standardCost: 1000,
			attributes: { color: "青", size: "L" },
		});
		expect(created.sku).toBe("TEE-BLUE-L");
		expect(created.attributes).toEqual({ color: "青", size: "L" });
		const found = await svc.findBySku("TEE-BLUE-L");
		expect(found?.id).toBe(created.id);
	});

	it("rejects duplicate sku with ConflictError", async () => {
		await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-A",
			variantType: "simple",
			unitPrice: 1000,
			standardCost: 0,
		});
		await expect(
			svc.create({
				productCode: "PRD-TEE",
				sku: "TEE-A",
				variantType: "simple",
				unitPrice: 2000,
				standardCost: 0,
			}),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("rejects variant creation for missing product", async () => {
		await expect(
			svc.create({
				productCode: "PRD-UNKNOWN",
				sku: "X-1",
				variantType: "simple",
				unitPrice: 100,
				standardCost: 0,
			}),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("updates price and attributes while keeping sku immutable", async () => {
		await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-X",
			variantType: "simple",
			unitPrice: 1000,
			standardCost: 0,
		});
		const updated = await svc.update("TEE-X", {
			unitPrice: 1500,
			attributes: { color: "緑" },
		});
		expect(updated.unitPrice).toBe(1500);
		expect(updated.attributes).toEqual({ color: "緑" });
		expect(updated.sku).toBe("TEE-X");
	});

	it("lists variants filtered by product and type", async () => {
		await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-1",
			variantType: "simple",
			unitPrice: 1000,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-MUG",
			sku: "MUG-1",
			variantType: "simple",
			unitPrice: 500,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-GIFT",
			sku: "SET-1",
			variantType: "bundle",
			unitPrice: 2000,
			standardCost: 0,
		});

		const onlyTee = await svc.list({
			productCode: "PRD-TEE",
			includeInactive: false,
			limit: 50,
			offset: 0,
		});
		expect(onlyTee.items.map((v) => v.sku)).toEqual(["TEE-1"]);

		const bundles = await svc.list({
			variantType: "bundle",
			includeInactive: false,
			limit: 50,
			offset: 0,
		});
		expect(bundles.items.map((v) => v.sku)).toEqual(["SET-1"]);
	});

	it("defines bundle components and lists them", async () => {
		await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-COMP",
			variantType: "simple",
			unitPrice: 1000,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-MUG",
			sku: "MUG-COMP",
			variantType: "simple",
			unitPrice: 500,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-GIFT",
			sku: "SET-B",
			variantType: "bundle",
			unitPrice: 1400,
			standardCost: 0,
		});

		await svc.defineBundleComponent({ bundleSku: "SET-B", componentSku: "TEE-COMP", qty: 1 });
		await svc.defineBundleComponent({ bundleSku: "SET-B", componentSku: "MUG-COMP", qty: 2 });

		const components = await svc.listBundleComponents("SET-B");
		expect(components).toHaveLength(2);
		expect(components[0]?.componentSku).toBe("TEE-COMP");
		expect(components[0]?.qty).toBe(1);
		expect(components[1]?.componentSku).toBe("MUG-COMP");
		expect(components[1]?.qty).toBe(2);
	});

	it("rejects bundle component on non-bundle variant (nested bundles)", async () => {
		await svc.create({
			productCode: "PRD-TEE",
			sku: "SIMPLE-1",
			variantType: "simple",
			unitPrice: 100,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-MUG",
			sku: "SIMPLE-2",
			variantType: "simple",
			unitPrice: 100,
			standardCost: 0,
		});
		await expect(
			svc.defineBundleComponent({ bundleSku: "SIMPLE-1", componentSku: "SIMPLE-2", qty: 1 }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("rejects nested bundles (component must be simple)", async () => {
		await svc.create({
			productCode: "PRD-GIFT",
			sku: "BUNDLE-A",
			variantType: "bundle",
			unitPrice: 1000,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-GIFT",
			sku: "BUNDLE-B",
			variantType: "bundle",
			unitPrice: 1000,
			standardCost: 0,
		});
		await expect(
			svc.defineBundleComponent({ bundleSku: "BUNDLE-A", componentSku: "BUNDLE-B", qty: 1 }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("expands a simple variant to itself", async () => {
		const v = await svc.create({
			productCode: "PRD-TEE",
			sku: "SIMPLE-X",
			variantType: "simple",
			unitPrice: 100,
			standardCost: 0,
		});
		const expanded = await svc.expandBundle(v.id, 7);
		expect(expanded).toEqual([
			{ variantId: v.id, sku: "SIMPLE-X", perBundleQty: 1, totalRequiredQty: 7 },
		]);
	});

	it("expands a bundle into component requirements", async () => {
		const tee = await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-E1",
			variantType: "simple",
			unitPrice: 1000,
			standardCost: 0,
		});
		const mug = await svc.create({
			productCode: "PRD-MUG",
			sku: "MUG-E1",
			variantType: "simple",
			unitPrice: 500,
			standardCost: 0,
		});
		const bundle = await svc.create({
			productCode: "PRD-GIFT",
			sku: "SET-E1",
			variantType: "bundle",
			unitPrice: 1400,
			standardCost: 0,
		});
		await svc.defineBundleComponent({ bundleSku: "SET-E1", componentSku: "TEE-E1", qty: 1 });
		await svc.defineBundleComponent({ bundleSku: "SET-E1", componentSku: "MUG-E1", qty: 2 });

		const expanded = await svc.expandBundle(bundle.id, 3);
		const byVariant = new Map(expanded.map((e) => [e.variantId, e]));
		expect(byVariant.get(tee.id)?.totalRequiredQty).toBe(3);
		expect(byVariant.get(mug.id)?.totalRequiredQty).toBe(6);
	});

	it("throws on expanding a bundle without components", async () => {
		const bundle = await svc.create({
			productCode: "PRD-GIFT",
			sku: "SET-EMPTY",
			variantType: "bundle",
			unitPrice: 1000,
			standardCost: 0,
		});
		await expect(svc.expandBundle(bundle.id, 1)).rejects.toBeInstanceOf(ValidationError);
	});

	it("getBundleAvailability returns 0 when no stock exists", async () => {
		const bundle = await svc.create({
			productCode: "PRD-GIFT",
			sku: "SET-AV-0",
			variantType: "bundle",
			unitPrice: 1000,
			standardCost: 0,
		});
		await svc.create({
			productCode: "PRD-TEE",
			sku: "TEE-AV-0",
			variantType: "simple",
			unitPrice: 100,
			standardCost: 0,
		});
		await svc.defineBundleComponent({
			bundleSku: "SET-AV-0",
			componentSku: "TEE-AV-0",
			qty: 1,
		});
		// No warehouse / stock yet → 0 bundles available.
		expect(await svc.getBundleAvailability(bundle.id, 999)).toBe(0);
	});
});
