import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { LocationService } from "../location/service.js";
import { ProductService } from "../product/service.js";
import { StockService } from "../stock/service.js";
import { VariantService } from "../variant/service.js";
import { WarehouseService } from "../warehouse/service.js";
import { InboundService } from "./service.js";

describe("InboundService.receive", () => {
	let ctx: TestDb;
	let productSvc: ProductService;
	let variantSvc: VariantService;
	let warehouseSvc: WarehouseService;
	let locationSvc: LocationService;
	let stockSvc: StockService;
	let svc: InboundService;

	beforeEach(async () => {
		ctx = await createTestDb();
		productSvc = new ProductService(ctx.db);
		variantSvc = new VariantService(ctx.db);
		warehouseSvc = new WarehouseService(ctx.db);
		locationSvc = new LocationService(ctx.db);
		stockSvc = new StockService(ctx.db);
		svc = new InboundService(ctx.db);

		await productSvc.create({ code: "PRD-TEE", name: "Tシャツ" });
		await variantSvc.create({
			productCode: "PRD-TEE",
			sku: "TEE-A",
			variantType: "simple",
			unitPrice: 2000,
			standardCost: 1000,
		});
		await warehouseSvc.create({ code: "WH1", name: "本社" });
		await locationSvc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await locationSvc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/BIN-1",
			locationType: "bin",
		});
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a receipt, pushes cost layer, adjusts stock, and records movement", async () => {
		const result = await svc.receive({
			warehouseCode: "WH1",
			lines: [
				{
					sku: "TEE-A",
					locationFullPath: "WH1/ZONE-A/BIN-1",
					qty: 10,
					unitCost: 600,
				},
			],
		});
		expect(result.receipt.receiptNumber).toMatch(/^GR-\d{8}-\d+-[A-Z0-9]+$/);
		expect(result.lines).toHaveLength(1);

		const stocks = await stockSvc.query({ sku: "TEE-A", includeZero: false });
		expect(stocks).toHaveLength(1);
		expect(stocks[0]?.onHandQty).toBe(10);
		expect(stocks[0]?.fullPath).toBe("WH1/ZONE-A/BIN-1");

		const layers = await ctx.db.execute({
			sql: "SELECT unit_cost, remaining_qty FROM cost_layers WHERE variant_id = ?",
			args: [result.lines[0]?.variantId ?? 0],
		});
		expect(layers.rows).toHaveLength(1);
		expect(Number(layers.rows[0]?.unit_cost)).toBe(600);
		expect(Number(layers.rows[0]?.remaining_qty)).toBe(10);

		const movements = await stockSvc.listMovements({ sku: "TEE-A", limit: 50, offset: 0 });
		expect(movements).toHaveLength(1);
		expect(movements[0]?.movementType).toBe("inbound");
		expect(movements[0]?.qty).toBe(10);
		expect(movements[0]?.unitCost).toBe(600);
		expect(movements[0]?.refType).toBe("goods_receipt");
	});

	it("supports multiple receive calls producing FIFO-ordered cost layers", async () => {
		await svc.receive({
			warehouseCode: "WH1",
			receivedAt: "2026-04-01 10:00:00",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 600 }],
		});
		await svc.receive({
			warehouseCode: "WH1",
			receivedAt: "2026-04-02 10:00:00",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 10, unitCost: 700 }],
		});

		const stocks = await stockSvc.query({ sku: "TEE-A", includeZero: false });
		expect(stocks[0]?.onHandQty).toBe(20);

		const layers = await ctx.db.execute({
			sql: "SELECT unit_cost, remaining_qty FROM cost_layers WHERE variant_id = (SELECT id FROM product_variants WHERE sku = ?) ORDER BY received_at ASC, id ASC",
			args: ["TEE-A"],
		});
		expect(layers.rows).toHaveLength(2);
		expect(Number(layers.rows[0]?.unit_cost)).toBe(600);
		expect(Number(layers.rows[1]?.unit_cost)).toBe(700);
	});

	it("rolls back the whole receipt when one line fails validation", async () => {
		await expect(
			svc.receive({
				warehouseCode: "WH1",
				lines: [
					{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 5, unitCost: 500 },
					{
						sku: "UNKNOWN-SKU",
						locationFullPath: "WH1/ZONE-A/BIN-1",
						qty: 3,
						unitCost: 100,
					},
				],
			}),
		).rejects.toBeInstanceOf(NotFoundError);

		const stocks = await stockSvc.query({ sku: "TEE-A", includeZero: true });
		expect(stocks).toHaveLength(0);

		const layers = await ctx.db.execute({
			sql: "SELECT COUNT(*) AS c FROM cost_layers",
		});
		expect(Number(layers.rows[0]?.c)).toBe(0);
	});

	it("rejects bundle variant as receive target", async () => {
		await productSvc.create({ code: "PRD-GIFT", name: "ギフトセット" });
		await variantSvc.create({
			productCode: "PRD-GIFT",
			sku: "SET-X",
			variantType: "bundle",
			unitPrice: 3000,
			standardCost: 0,
		});
		await expect(
			svc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "SET-X", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 1, unitCost: 100 }],
			}),
		).rejects.toThrow(/non-simple variant/);
	});

	it("rejects when warehouse is archived", async () => {
		await warehouseSvc.archive("WH1");
		await expect(
			svc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 1, unitCost: 100 }],
			}),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("bundle availability reflects real stock after inbound", async () => {
		await productSvc.create({ code: "PRD-MUG", name: "マグ" });
		await variantSvc.create({
			productCode: "PRD-MUG",
			sku: "MUG-A",
			variantType: "simple",
			unitPrice: 500,
			standardCost: 0,
		});
		await productSvc.create({ code: "PRD-GIFT", name: "ギフトセット" });
		const bundle = await variantSvc.create({
			productCode: "PRD-GIFT",
			sku: "SET-Y",
			variantType: "bundle",
			unitPrice: 2000,
			standardCost: 0,
		});
		await variantSvc.defineBundleComponent({
			bundleSku: "SET-Y",
			componentSku: "TEE-A",
			qty: 1,
		});
		await variantSvc.defineBundleComponent({
			bundleSku: "SET-Y",
			componentSku: "MUG-A",
			qty: 2,
		});

		await svc.receive({
			warehouseCode: "WH1",
			lines: [
				{ sku: "TEE-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 5, unitCost: 1000 },
				{ sku: "MUG-A", locationFullPath: "WH1/ZONE-A/BIN-1", qty: 6, unitCost: 400 },
			],
		});

		const warehouseRs = await ctx.db.execute({
			sql: "SELECT id FROM warehouses WHERE code = ?",
			args: ["WH1"],
		});
		const warehouseId = Number(warehouseRs.rows[0]?.id);

		// min(floor(5/1), floor(6/2)) = min(5, 3) = 3
		const available = await variantSvc.getBundleAvailability(bundle.id, warehouseId);
		expect(available).toBe(3);
	});
});
