import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError } from "../../shared/errors/domain-error.js";
import { ProductService } from "./service.js";

describe("ProductService", () => {
	let ctx: TestDb;
	let svc: ProductService;

	beforeEach(async () => {
		ctx = await createTestDb();
		svc = new ProductService(ctx.db);
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a product and fetches it by code", async () => {
		const created = await svc.create({ code: "PRD-TEE", name: "Tシャツ" });
		expect(created.code).toBe("PRD-TEE");
		expect(created.isActive).toBe(true);
		const found = await svc.findByCode("PRD-TEE");
		expect(found).not.toBeNull();
		expect(found?.id).toBe(created.id);
	});

	it("rejects duplicate codes with ConflictError", async () => {
		await svc.create({ code: "PRD-1", name: "A" });
		await expect(svc.create({ code: "PRD-1", name: "B" })).rejects.toBeInstanceOf(ConflictError);
	});

	it("requireByCode throws NotFoundError for missing", async () => {
		await expect(svc.requireByCode("DOES-NOT-EXIST")).rejects.toBeInstanceOf(NotFoundError);
	});

	it("lists products with pagination (active only by default)", async () => {
		await svc.create({ code: "P-1", name: "one" });
		await svc.create({ code: "P-2", name: "two" });
		const archived = await svc.create({ code: "P-3", name: "three" });
		await svc.archive(archived.code);

		const page = await svc.list({ limit: 10, offset: 0, includeInactive: false });
		expect(page.total).toBe(2);
		expect(page.items.map((p) => p.code)).toEqual(["P-1", "P-2"]);

		const all = await svc.list({ limit: 10, offset: 0, includeInactive: true });
		expect(all.total).toBe(3);
	});

	it("updates mutable fields and keeps code immutable", async () => {
		await svc.create({ code: "P-X", name: "orig" });
		const updated = await svc.update("P-X", { name: "renamed", description: "new desc" });
		expect(updated.name).toBe("renamed");
		expect(updated.description).toBe("new desc");
		expect(updated.code).toBe("P-X");
	});

	it("archive then unarchive flips isActive", async () => {
		await svc.create({ code: "P-A", name: "a" });
		const archived = await svc.archive("P-A");
		expect(archived.isActive).toBe(false);
		const restored = await svc.unarchive("P-A");
		expect(restored.isActive).toBe(true);
	});
});
