import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError } from "../../shared/errors/domain-error.js";
import { InboundService } from "../inbound/service.js";
import { LocationService } from "../location/service.js";
import { OrderService } from "../order/service.js";
import { ProductService } from "../product/service.js";
import { StockService } from "../stock/service.js";
import { VariantService } from "../variant/service.js";
import { WarehouseService } from "../warehouse/service.js";
import { ShipmentService } from "./service.js";

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
	shipmentSvc: ShipmentService;
}> {
	const productSvc = new ProductService(ctx.db);
	const variantSvc = new VariantService(ctx.db);
	const warehouseSvc = new WarehouseService(ctx.db);
	const locationSvc = new LocationService(ctx.db);
	const stockSvc = new StockService(ctx.db);
	const inboundSvc = new InboundService(ctx.db);
	const orderSvc = new OrderService(ctx.db);
	const shipmentSvc = new ShipmentService(ctx.db);

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
	await variantSvc.defineBundleComponent({
		bundleSku: "SET-A",
		componentSku: "TEE-A",
		qty: 1,
	});
	await variantSvc.defineBundleComponent({
		bundleSku: "SET-A",
		componentSku: "MUG-A",
		qty: 2,
	});

	await warehouseSvc.create({ code: "WH1", name: "本社" });
	await locationSvc.create({ warehouseCode: "WH1", path: "Z", locationType: "zone" });
	await locationSvc.create({ warehouseCode: "WH1", path: "Z/B-1", locationType: "bin" });

	await seedCustomer(ctx, "CUST-1", "Alice");

	return {
		productSvc,
		variantSvc,
		warehouseSvc,
		locationSvc,
		stockSvc,
		inboundSvc,
		orderSvc,
		shipmentSvc,
	};
}

describe("ShipmentService", () => {
	let ctx: TestDb;
	let fx: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		fx = await setup(ctx);
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("ships a simple-variant order and stamps captured_unit_cost (FIFO weighted avg)", async () => {
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			receivedAt: "2026-04-01 10:00:00",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 10, unitCost: 600 }],
		});
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			receivedAt: "2026-04-02 10:00:00",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 10, unitCost: 800 }],
		});
		const order = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", qty: 15, lineDiscount: 0 }],
		});
		await fx.orderSvc.confirm(order.order.orderNumber);

		const result = await fx.shipmentSvc.ship({ orderNumber: order.order.orderNumber });
		expect(result.shipment.status).toBe("shipped");
		expect(result.totalCost).toBe(10 * 600 + 5 * 800); // 10000
		expect(result.totalRevenue).toBe(15 * 2000);

		const detail = await fx.orderSvc.requireByNumber(order.order.orderNumber);
		expect(detail.order.status).toBe("shipped");
		expect(detail.lines[0]?.capturedUnitCost).toBe(Math.floor(10000 / 15));

		const stock = await fx.stockSvc.query({ sku: "TEE-A", includeZero: true });
		expect(stock[0]?.onHandQty).toBe(5);
		expect(stock[0]?.reservedQty).toBe(0);
	});

	it("ships a bundle order, distributing cost across components", async () => {
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			lines: [
				{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 10, unitCost: 1000 },
				{ sku: "MUG-A", locationFullPath: "WH1/Z/B-1", qty: 20, unitCost: 400 },
			],
		});
		const order = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "SET-A", qty: 3, lineDiscount: 0 }],
		});
		await fx.orderSvc.confirm(order.order.orderNumber);

		const result = await fx.shipmentSvc.ship({
			orderNumber: order.order.orderNumber,
			carrier: "ヤマト",
			trackingNumber: "TRK-001",
		});
		// SET-A × 3 = TEE-A × 3 @ 1000 + MUG-A × 6 @ 400 = 3000 + 2400 = 5400
		expect(result.totalCost).toBe(5400);
		expect(result.totalRevenue).toBe(3 * 2500);

		const reloaded = await fx.orderSvc.requireByNumber(order.order.orderNumber);
		expect(reloaded.order.status).toBe("shipped");
		expect(reloaded.lines[0]?.capturedUnitCost).toBe(Math.floor(5400 / 3));
		// all allocations should have consumed_cost populated
		expect(reloaded.allocations.every((a) => a.consumedCost !== null)).toBe(true);

		// GL entries: AR 7500 debit, Sales 7500 credit, COGS 5400 debit, Inventory 5400 credit
		const gl = await ctx.db.execute({
			sql: "SELECT account, debit, credit FROM gl_entries WHERE ref_type = ? AND ref_id = ? ORDER BY id",
			args: ["shipment", result.shipment.id],
		});
		const byAccount = Object.fromEntries(
			gl.rows.map((r) => [String(r.account), { d: Number(r.debit), c: Number(r.credit) }]),
		);
		expect(byAccount.ar).toEqual({ d: 7500, c: 0 });
		expect(byAccount.sales).toEqual({ d: 0, c: 7500 });
		expect(byAccount.cogs).toEqual({ d: 5400, c: 0 });
		expect(byAccount.inventory).toEqual({ d: 0, c: 5400 });

		const totalDebit = gl.rows.reduce((s, r) => s + Number(r.debit), 0);
		const totalCredit = gl.rows.reduce((s, r) => s + Number(r.credit), 0);
		expect(totalDebit).toBe(totalCredit);
	});

	it("refuses to ship a pending order", async () => {
		const order = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", qty: 1, lineDiscount: 0 }],
		});
		await expect(
			fx.shipmentSvc.ship({ orderNumber: order.order.orderNumber }),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("refuses to ship twice (order no longer confirmed)", async () => {
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 5, unitCost: 500 }],
		});
		const order = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", qty: 2, lineDiscount: 0 }],
		});
		await fx.orderSvc.confirm(order.order.orderNumber);
		await fx.shipmentSvc.ship({ orderNumber: order.order.orderNumber });
		await expect(
			fx.shipmentSvc.ship({ orderNumber: order.order.orderNumber }),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("markDelivered flips shipment + order to delivered", async () => {
		await fx.inboundSvc.receive({
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", locationFullPath: "WH1/Z/B-1", qty: 5, unitCost: 500 }],
		});
		const order = await fx.orderSvc.create({
			customerCode: "CUST-1",
			warehouseCode: "WH1",
			lines: [{ sku: "TEE-A", qty: 2, lineDiscount: 0 }],
		});
		await fx.orderSvc.confirm(order.order.orderNumber);
		const shipResult = await fx.shipmentSvc.ship({
			orderNumber: order.order.orderNumber,
		});
		const delivered = await fx.shipmentSvc.markDelivered(shipResult.shipment.shipmentNumber);
		expect(delivered.shipment.status).toBe("delivered");

		const reloadedOrder = await fx.orderSvc.requireByNumber(order.order.orderNumber);
		expect(reloadedOrder.order.status).toBe("delivered");
	});
});
