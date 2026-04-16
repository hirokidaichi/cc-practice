import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { InboundService } from "../inbound/service.js";
import { LocationService } from "../location/service.js";
import { ProductService } from "../product/service.js";
import { StockService } from "../stock/service.js";
import { VariantService } from "../variant/service.js";
import { WarehouseService } from "../warehouse/service.js";
import { OrderService } from "./service.js";

async function seedCustomer(ctx: TestDb, code: string, name: string): Promise<void> {
	await ctx.db.execute({
		sql: "INSERT INTO customers (code, name) VALUES (?, ?)",
		args: [code, name],
	});
}

async function setup(ctx: TestDb): Promise<{
	productSvc: ProductService;
	variantSvc: VariantService;
	warehouseSvc: WarehouseService;
	locationSvc: LocationService;
	stockSvc: StockService;
	inboundSvc: InboundService;
	orderSvc: OrderService;
}> {
	const productSvc = new ProductService(ctx.db);
	const variantSvc = new VariantService(ctx.db);
	const warehouseSvc = new WarehouseService(ctx.db);
	const locationSvc = new LocationService(ctx.db);
	const stockSvc = new StockService(ctx.db);
	const inboundSvc = new InboundService(ctx.db);
	const orderSvc = new OrderService(ctx.db);

	await productSvc.create({ code: "PRD-TEE", name: "Tシャツ" });
	await variantSvc.create({
		productCode: "PRD-TEE",
		sku: "TEE-A",
		variantType: "simple",
		unitPrice: 2000,
		standardCost: 0,
	});
	await productSvc.create({ code: "PRD-MUG", name: "マグ" });
	await variantSvc.create({
		productCode: "PRD-MUG",
		sku: "MUG-A",
		variantType: "simple",
		unitPrice: 800,
		standardCost: 0,
	});
	await productSvc.create({ code: "PRD-GIFT", name: "ギフト" });
	await variantSvc.create({
		productCode: "PRD-GIFT",
		sku: "SET-A",
		variantType: "bundle",
		unitPrice: 2500,
		standardCost: 0,
	});
	await variantSvc.defineBundleComponent({ bundleSku: "SET-A", componentSku: "TEE-A", qty: 1 });
	await variantSvc.defineBundleComponent({ bundleSku: "SET-A", componentSku: "MUG-A", qty: 2 });

	await warehouseSvc.create({ code: "WH1", name: "本社" });
	await locationSvc.create({ warehouseCode: "WH1", path: "Z", locationType: "zone" });
	await locationSvc.create({ warehouseCode: "WH1", path: "Z/B-1", locationType: "bin" });
	await locationSvc.create({ warehouseCode: "WH1", path: "Z/B-2", locationType: "bin" });

	await seedCustomer(ctx, "CUST-1", "Alice");

	return {
		productSvc,
		variantSvc,
		warehouseSvc,
		locationSvc,
		stockSvc,
		inboundSvc,
		orderSvc,
	};
}

describe("OrderService", () => {
	let ctx: TestDb;
	let fx: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		fx = await setup(ctx);
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a pending order with frozen unit_price and totals", async () => {
		const detail = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [
				{ sku: "TEE-A", qty: 2, lineDiscount: 100 },
				{ sku: "MUG-A", qty: 3, lineDiscount: 0 },
			],
		});
		expect(detail.order.status).toBe("pending");
		expect(detail.lines).toHaveLength(2);
		expect(detail.order.subtotalAmount).toBe(2 * 2000 + 3 * 800); // 6400
		expect(detail.order.discountAmount).toBe(100);
		expect(detail.order.totalAmount).toBe(6300);
		expect(detail.allocations).toHaveLength(0);
	});

	it("rejects creation for missing customer / warehouse / variant", async () => {
		await expect(
			fx.orderSvc.create({
				customerCode: "NOPE",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "NOWH",
				lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "UNKNOWN", qty: 1, lineDiscount: 0 }],
			}),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	describe("confirm — simple variant", () => {
		it("reserves stock from the most-available location first", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [
					{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 4, unitCost: 500 },
					{ sku: "TEE-A", locationFullPath: "WH1/Z/B-2", qty: 7, unitCost: 500 },
				],
			});

			const created = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 9, lineDiscount: 0 }],
			});
			const confirmed = await fx.orderSvc.confirm(created.order.orderNumber);
			expect(confirmed.order.status).toBe("confirmed");
			expect(confirmed.order.confirmedAt).toBeTruthy();
			expect(confirmed.allocations).toHaveLength(2);
			// Highest-available (B-2 has 7) goes first, so it should be 7 from B-2 and 2 from B-1.
			const sorted = [...confirmed.allocations].sort((a, b) => b.allocatedQty - a.allocatedQty);
			expect(sorted[0]?.allocatedQty).toBe(7);
			expect(sorted[1]?.allocatedQty).toBe(2);

			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
			const byLoc = Object.fromEntries(stock.map((s) => [s.fullPath, s]));
			expect(byLoc["WH1/Z/B-1"]?.reservedQty).toBe(2);
			expect(byLoc["WH1/Z/B-2"]?.reservedQty).toBe(7);
			expect(byLoc["WH1/Z/B-1"]?.availableQty).toBe(2);
			expect(byLoc["WH1/Z/B-2"]?.availableQty).toBe(0);
		});
	});

	describe("confirm — bundle variant", () => {
		it("expands components and reserves each separately", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [
					{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 10, unitCost: 1000 },
					{ sku: "MUG-A", locationFullPath: "WH1/Z/B-1", qty: 20, unitCost: 400 },
				],
			});

			const created = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "SET-A", qty: 3, lineDiscount: 0 }],
			});
			// SET-A = 1 TEE-A + 2 MUG-A per bundle. qty 3 → 3 TEE-A, 6 MUG-A
			const confirmed = await fx.orderSvc.confirm(created.order.orderNumber);
			expect(confirmed.allocations).toHaveLength(2);
			const totalByVariant = new Map<number, number>();
			for (const a of confirmed.allocations) {
				totalByVariant.set(
					a.componentVariantId,
					(totalByVariant.get(a.componentVariantId) ?? 0) + a.allocatedQty,
				);
			}
			const teeId = (await fx.variantSvc.requireBySku("TEE-A")).id;
			const mugId = (await fx.variantSvc.requireBySku("MUG-A")).id;
			expect(totalByVariant.get(teeId)).toBe(3);
			expect(totalByVariant.get(mugId)).toBe(6);
		});
	});

	describe("confirm — insufficient stock", () => {
		it("rolls back the whole confirmation (no partial reserves)", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [
					{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 5, unitCost: 1000 },
					// MUG-A has NO stock → bundle confirmation should fail halfway through
				],
			});
			const created = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "SET-A", qty: 2, lineDiscount: 0 }],
			});
			await expect(fx.orderSvc.confirm(created.order.orderNumber)).rejects.toBeInstanceOf(
				ConflictError,
			);

			const reloaded = await fx.orderSvc.requireByNumber(created.order.orderNumber);
			expect(reloaded.order.status).toBe("pending");
			expect(reloaded.allocations).toHaveLength(0);

			const stocks = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
			expect(stocks[0]?.reservedQty).toBe(0); // Tee reserve rolled back
		});
	});

	it("confirm is idempotent-guarded (second confirm fails)", async () => {
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 5, unitCost: 500 }],
		});
		const created = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", qty: 2, lineDiscount: 0 }],
		});
		await fx.orderSvc.confirm(created.order.orderNumber);
		await expect(fx.orderSvc.confirm(created.order.orderNumber)).rejects.toBeInstanceOf(
			ConflictError,
		);
	});

	describe("cancel", () => {
		it("cancels a pending order with no stock movement", async () => {
			const created = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
			});
			const cancelled = await fx.orderSvc.cancel(created.order.orderNumber);
			expect(cancelled.order.status).toBe("cancelled");
			expect(cancelled.order.cancelledAt).toBeTruthy();
		});

		it("releases reserves from a confirmed order", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 10, unitCost: 500 }],
			});
			const created = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 7, lineDiscount: 0 }],
			});
			await fx.orderSvc.confirm(created.order.orderNumber);
			const cancelled = await fx.orderSvc.cancel(created.order.orderNumber);
			expect(cancelled.order.status).toBe("cancelled");
			expect(cancelled.allocations).toHaveLength(0);

			const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: false });
			expect(stock[0]?.reservedQty).toBe(0);
			expect(stock[0]?.availableQty).toBe(10);
		});
	});

	describe("list", () => {
		it("filters by status", async () => {
			await fx.inboundSvc.receive({
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 5, unitCost: 500 }],
			});
			const a = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
			});
			const b = await fx.orderSvc.create({
				customerCode: "CUST-1",
				warehouseCode: "WH1",
				lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
			});
			await fx.orderSvc.confirm(b.order.orderNumber);

			const pending = await fx.orderSvc.list({
				status: "pending",
				limit: 50,
				offset: 0,
			});
			expect(pending.items.map((o) => o.orderNumber)).toEqual([a.order.orderNumber]);
			const confirmed = await fx.orderSvc.list({
				status: "confirmed",
				limit: 50,
				offset: 0,
			});
			expect(confirmed.items.map((o) => o.orderNumber)).toEqual([b.order.orderNumber]);
		});
	});
});
