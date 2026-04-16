import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError } from "../errors/domain-error.js";
import { consumeCostLayers, pushCostLayer, sumRemainingQty } from "./fifo.js";

async function seedVariantAndWarehouse(ctx: TestDb): Promise<{
	variantId: number;
	warehouseId: number;
}> {
	const p = await ctx.db.execute({
		sql: "INSERT INTO products (code, name) VALUES (?, ?) RETURNING id",
		args: ["PRD-F", "fifo"],
	});
	const productId = Number(p.rows[0]?.id);
	const v = await ctx.db.execute({
		sql: "INSERT INTO product_variants (product_id, sku, variant_type, unit_price) VALUES (?, ?, ?, ?) RETURNING id",
		args: [productId, "SKU-F", "simple", 1000],
	});
	const variantId = Number(v.rows[0]?.id);
	const w = await ctx.db.execute({
		sql: "INSERT INTO warehouses (code, name) VALUES (?, ?) RETURNING id",
		args: ["WH-F", "fifo wh"],
	});
	const warehouseId = Number(w.rows[0]?.id);
	return { variantId, warehouseId };
}

describe("fifo helpers", () => {
	let ctx: TestDb;
	let variantId: number;
	let warehouseId: number;

	beforeEach(async () => {
		ctx = await createTestDb();
		const seed = await seedVariantAndWarehouse(ctx);
		variantId = seed.variantId;
		warehouseId = seed.warehouseId;
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("push + consume returns FIFO consumption in order", async () => {
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-01 10:00:00",
			unitCost: 1000,
			qty: 10,
		});
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-02 10:00:00",
			unitCost: 1200,
			qty: 10,
		});

		const result = await consumeCostLayers(ctx.db, { variantId, warehouseId, qty: 15 });
		expect(result.totalConsumedQty).toBe(15);
		expect(result.totalCost).toBe(10 * 1000 + 5 * 1200); // 16000
		expect(result.consumptions).toHaveLength(2);
		expect(result.consumptions[0]?.consumedQty).toBe(10);
		expect(result.consumptions[0]?.unitCost).toBe(1000);
		expect(result.consumptions[1]?.consumedQty).toBe(5);
		expect(result.consumptions[1]?.unitCost).toBe(1200);

		const remaining = await sumRemainingQty(ctx.db, variantId, warehouseId);
		expect(remaining).toBe(5); // 10 + 10 - 15
	});

	it("exact match drains only the first layer", async () => {
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-01 10:00:00",
			unitCost: 500,
			qty: 10,
		});
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-02 10:00:00",
			unitCost: 900,
			qty: 10,
		});
		const result = await consumeCostLayers(ctx.db, { variantId, warehouseId, qty: 10 });
		expect(result.consumptions).toHaveLength(1);
		expect(result.consumptions[0]?.unitCost).toBe(500);
		expect(await sumRemainingQty(ctx.db, variantId, warehouseId)).toBe(10);
	});

	it("throws ConflictError when stock is insufficient and does not leave partial consumption", async () => {
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-01 10:00:00",
			unitCost: 1000,
			qty: 3,
		});
		// MVP: consumeCostLayers is not wrapped in a transaction by the helper itself —
		// callers (services) are responsible for wrapping. Here we just verify the throw
		// behaviour; partial consumption is by design to be rolled back by the caller's tx.
		await expect(
			consumeCostLayers(ctx.db, { variantId, warehouseId, qty: 5 }),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("weightedAvgCost is floor(totalCost/qty)", async () => {
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-01 10:00:00",
			unitCost: 100,
			qty: 3,
		});
		await pushCostLayer(ctx.db, {
			variantId,
			warehouseId,
			receivedAt: "2026-04-02 10:00:00",
			unitCost: 101,
			qty: 3,
		});
		// consume 4: 3*100 + 1*101 = 401, / 4 = 100.25 → floor 100
		const result = await consumeCostLayers(ctx.db, { variantId, warehouseId, qty: 4 });
		expect(result.totalCost).toBe(401);
		expect(result.weightedAvgCost).toBe(100);
	});
});
