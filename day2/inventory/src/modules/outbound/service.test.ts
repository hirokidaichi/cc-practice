import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, ValidationError } from "../../shared/errors/domain-error.js";
import { InboundService } from "../inbound/service.js";
import { LocationService } from "../location/service.js";
import { ProductService } from "../product/service.js";
import { StockService } from "../stock/service.js";
import { VariantService } from "../variant/service.js";
import { WarehouseService } from "../warehouse/service.js";
import { OutboundService } from "./service.js";

async function setupFixtures(ctx: TestDb): Promise<{
	productSvc: ProductService;
	variantSvc: VariantService;
	warehouseSvc: WarehouseService;
	locationSvc: LocationService;
	stockSvc: StockService;
	inboundSvc: InboundService;
	outboundSvc: OutboundService;
}> {
	const productSvc = new ProductService(ctx.db);
	const variantSvc = new VariantService(ctx.db);
	const warehouseSvc = new WarehouseService(ctx.db);
	const locationSvc = new LocationService(ctx.db);
	const stockSvc = new StockService(ctx.db);
	const inboundSvc = new InboundService(ctx.db);
	const outboundSvc = new OutboundService(ctx.db);

	await productSvc.create({ code: "PRD-TEE", name: "Tシャツ" });
	await variantSvc.create({
		productCode: "PRD-TEE",
		sku: "TEE-A",
		variantType: "simple",
		unitPrice: 2000,
		standardCost: 0,
	});
	await warehouseSvc.create({ code: "WH1", name: "本社" });
	await warehouseSvc.create({ code: "WH2", name: "大阪" });
	await locationSvc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
	await locationSvc.create({ warehouseCode: "WH1", path: "ZONE-A/BIN-1", locationType: "bin" });
	await locationSvc.create({ warehouseCode: "WH1", path: "ZONE-A/BIN-2", locationType: "bin" });
	await locationSvc.create({ warehouseCode: "WH2", path: "ZONE-1", locationType: "zone" });
	await locationSvc.create({ warehouseCode: "WH2", path: "ZONE-1/BIN-1", locationType: "bin" });

	return {
		productSvc,
		variantSvc,
		warehouseSvc,
		locationSvc,
		stockSvc,
		inboundSvc,
		outboundSvc,
	};
}

describe("OutboundService", () => {
	let ctx: TestDb;
	let fx: Awaited<ReturnType<typeof setupFixtures>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		fx = await setupFixtures(ctx);
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	describe("pick", () => {
		it("consumes FIFO oldest-first and decrements stock at the source location", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				receivedAt: "2026-04-01 10:00:00",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 600 }],
			});
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				receivedAt: "2026-04-02 10:00:00",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 700 }],
			});

			const result = await fx.outboundSvc.pick({
				sku: "TEE-A",
				locationFullPath: "WH1/ZONE-A/BIN-1",
				qty: 15,
			});
			expect(result.qty).toBe(15);
			expect(result.totalCost).toBe(10 * 600 + 5 * 700); // 9500
			expect(result.weightedAvgCost).toBe(Math.floor(9500 / 15));
			expect(result.consumptions.map((c) => c.consumedQty)).toEqual([10, 5]);

			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
			expect(stock[0]?.onHandQty).toBe(5);

			const movements = await fx.stockSvc.listMovements({ sku: "TEE-A", limit: 10, offset: 0 });
			// DESC by occurredAt → the outbound (now) comes first, then 2 inbounds.
			expect(movements[0]?.movementType).toBe("outbound");
			expect(movements[0]?.qty).toBe(-15);
		});

		it("throws ConflictError when stock is insufficient and does not mutate layers", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 3, unitCost: 500 }],
			});
			await expect(
				fx.outboundSvc.pick({
					sku: "TEE-A",
					locationFullPath: "WH1/ZONE-A/BIN-1",
					qty: 5,
				}),
			).rejects.toBeInstanceOf(ConflictError);

			const layers = await ctx.db.execute("SELECT SUM(remaining_qty) AS s FROM cost_layers");
			expect(Number(layers.rows[0]?.s)).toBe(3);
		});

		it("rejects bundle variants", async () => {
			await fx.productSvc.create({ code: "PRD-G", name: "g" });
			await fx.variantSvc.create({
				productCode: "PRD-G",
				sku: "SET-P",
				variantType: "bundle",
				unitPrice: 1000,
				standardCost: 0,
			});
			await expect(
				fx.outboundSvc.pick({
					sku: "SET-P",
					locationFullPath: "WH1/ZONE-A/BIN-1",
					qty: 1,
				}),
			).rejects.toBeInstanceOf(ValidationError);
		});
	});

	describe("adjustOut", () => {
		it("records an adjustment movement and consumes FIFO like a pick", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 800 }],
			});
			const result = await fx.outboundSvc.adjustOut({
				sku: "TEE-A",
				locationFullPath: "WH1/ZONE-A/BIN-1",
				qty: 2,
				note: "棚卸差異",
			});
			expect(result.qty).toBe(2);
			const movements = await fx.stockSvc.listMovements({
				sku: "TEE-A",
				movementType: "adjustment",
				limit: 10,
				offset: 0,
			});
			expect(movements).toHaveLength(1);
			expect(movements[0]?.qty).toBe(-2);
			expect(movements[0]?.note).toBe("棚卸差異");
		});
	});

	describe("transfer — intra-warehouse", () => {
		it("moves stock between locations without touching cost_layers", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				receivedAt: "2026-04-01 10:00:00",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 8, unitCost: 500 }],
			});

			const result = await fx.outboundSvc.transfer({
				sku: "TEE-A",
				fromLocationFullPath: "WH1/ZONE-A/BIN-1",
				toLocationFullPath: "WH1/ZONE-A/BIN-2",
				qty: 3,
			});
			expect(result.crossWarehouse).toBe(false);
			expect(result.weightedAvgCost).toBeUndefined();

			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: false });
			const byLoc = Object.fromEntries(stock.map((s) => [s.fullPath, s.onHandQty]));
			expect(byLoc["WH1/ZONE-A/BIN-1"]).toBe(5);
			expect(byLoc["WH1/ZONE-A/BIN-2"]).toBe(3);

			const layers = await ctx.db.execute(
				"SELECT unit_cost, remaining_qty FROM cost_layers ORDER BY id ASC",
			);
			expect(layers.rows).toHaveLength(1);
			expect(Number(layers.rows[0]?.remaining_qty)).toBe(8);
		});
	});

	describe("transfer — cross-warehouse", () => {
		it("consumes FIFO at source and pushes a new layer at destination with weighted avg cost", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				receivedAt: "2026-04-01 10:00:00",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 600 }],
			});
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				receivedAt: "2026-04-02 10:00:00",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 800 }],
			});

			const result = await fx.outboundSvc.transfer({
				sku: "TEE-A",
				fromLocationFullPath: "WH1/ZONE-A/BIN-1",
				toLocationFullPath: "WH2/ZONE-1/BIN-1",
				qty: 15,
				occurredAt: "2026-04-10 10:00:00",
			});
			expect(result.crossWarehouse).toBe(true);
			expect(result.totalCost).toBe(10 * 600 + 5 * 800); // 10000
			expect(result.weightedAvgCost).toBe(Math.floor(10000 / 15));

			const layers = await ctx.db.execute(
				"SELECT warehouse_id, unit_cost, remaining_qty FROM cost_layers ORDER BY id ASC",
			);
			// WH1 layer 1 consumed (0), WH1 layer 2 has 5 remaining, new WH2 layer has 15 at weighted avg
			const layerRows = layers.rows.map((r) => ({
				warehouse_id: Number(r.warehouse_id),
				unit_cost: Number(r.unit_cost),
				remaining_qty: Number(r.remaining_qty),
			}));
			expect(layerRows).toEqual([
				{ warehouse_id: 1, unit_cost: 600, remaining_qty: 0 },
				{ warehouse_id: 1, unit_cost: 800, remaining_qty: 5 },
				{ warehouse_id: 2, unit_cost: Math.floor(10000 / 15), remaining_qty: 15 },
			]);

			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
			const byLoc = Object.fromEntries(stock.map((s) => [s.fullPath, s.onHandQty]));
			expect(byLoc["WH1/ZONE-A/BIN-1"]).toBe(5);
			expect(byLoc["WH2/ZONE-1/BIN-1"]).toBe(15);
		});

		it("rolls back when source stock is insufficient", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 2, unitCost: 500 }],
			});
			await expect(
				fx.outboundSvc.transfer({
					sku: "TEE-A",
					fromLocationFullPath: "WH1/ZONE-A/BIN-1",
					toLocationFullPath: "WH2/ZONE-1/BIN-1",
					qty: 5,
				}),
			).rejects.toBeInstanceOf(ConflictError);

			// Source stock unchanged, destination has nothing.
			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
			const byLoc = Object.fromEntries(stock.map((s) => [s.fullPath, s.onHandQty]));
			expect(byLoc["WH1/ZONE-A/BIN-1"]).toBe(2);
			expect(byLoc["WH2/ZONE-1/BIN-1"]).toBeUndefined();
		});
	});

	it("transfer from=to is rejected", async () => {
		await expect(
			fx.outboundSvc.transfer({
				sku: "TEE-A",
				fromLocationFullPath: "WH1/ZONE-A/BIN-1",
				toLocationFullPath: "WH1/ZONE-A/BIN-1",
				qty: 1,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
