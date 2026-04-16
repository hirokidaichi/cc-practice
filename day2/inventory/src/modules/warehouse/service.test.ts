import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { WarehouseService } from "./service.js";

describe("WarehouseService", () => {
	let ctx: TestDb;
	let svc: WarehouseService;

	beforeEach(async () => {
		ctx = await createTestDb();
		svc = new WarehouseService(ctx.db);
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a warehouse and fetches by code", async () => {
		const created = await svc.create({ code: "WH1", name: "本社倉庫" });
		expect(created.code).toBe("WH1");
		expect(created.isActive).toBe(true);
		const found = await svc.findByCode("WH1");
		expect(found?.id).toBe(created.id);
	});

	it("rejects duplicate codes", async () => {
		await svc.create({ code: "W-DUP", name: "a" });
		await expect(svc.create({ code: "W-DUP", name: "b" })).rejects.toBeInstanceOf(ConflictError);
	});

	it("updates name and address", async () => {
		await svc.create({ code: "W-U", name: "old" });
		const updated = await svc.update("W-U", { name: "new", address: "東京" });
		expect(updated.name).toBe("new");
		expect(updated.address).toBe("東京");
	});

	it("archive/unarchive flips isActive", async () => {
		await svc.create({ code: "W-A", name: "a" });
		expect((await svc.archive("W-A")).isActive).toBe(false);
		expect((await svc.unarchive("W-A")).isActive).toBe(true);
	});

	it("requireByCode throws NotFoundError for missing", async () => {
		await expect(svc.requireByCode("NOPE")).rejects.toBeInstanceOf(NotFoundError);
	});

	it("lists only active warehouses by default", async () => {
		await svc.create({ code: "W-1", name: "a" });
		await svc.create({ code: "W-2", name: "b" });
		await svc.archive("W-2");
		const page = await svc.list({ includeInactive: false, limit: 50, offset: 0 });
		expect(page.total).toBe(1);
		expect(page.items[0]?.code).toBe("W-1");
		const all = await svc.list({ includeInactive: true, limit: 50, offset: 0 });
		expect(all.total).toBe(2);
	});
});
