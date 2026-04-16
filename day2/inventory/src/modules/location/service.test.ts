import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/test-db.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { WarehouseService } from "../warehouse/service.js";
import { LocationService } from "./service.js";

describe("LocationService", () => {
	let ctx: TestDb;
	let warehouseSvc: WarehouseService;
	let svc: LocationService;

	beforeEach(async () => {
		ctx = await createTestDb();
		warehouseSvc = new WarehouseService(ctx.db);
		svc = new LocationService(ctx.db);
		await warehouseSvc.create({ code: "WH1", name: "本社" });
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("creates a top-level location under a warehouse", async () => {
		const loc = await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A",
			locationType: "zone",
		});
		expect(loc.fullPath).toBe("WH1/ZONE-A");
		expect(loc.parentLocationId).toBeNull();
		expect(loc.locationType).toBe("zone");
	});

	it("creates a nested child location with existing parent", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		const bin = await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/BIN-3",
			locationType: "bin",
		});
		expect(bin.fullPath).toBe("WH1/ZONE-A/BIN-3");
		expect(bin.parentLocationId).not.toBeNull();
	});

	it("rejects nested creation when parent is missing", async () => {
		await expect(
			svc.create({
				warehouseCode: "WH1",
				path: "ZONE-X/BIN-1",
				locationType: "bin",
			}),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("rejects duplicate full_path", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await expect(
			svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" }),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("rejects empty path", async () => {
		await expect(
			svc.create({ warehouseCode: "WH1", path: "/", locationType: "zone" }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("resolveByFullPath returns null for unknown path", async () => {
		expect(await svc.resolveByFullPath("WH1/UNKNOWN")).toBeNull();
	});

	it("requireByFullPath throws for unknown path", async () => {
		await expect(svc.requireByFullPath("WH1/NOPE")).rejects.toBeInstanceOf(NotFoundError);
	});

	it("lists children of a parent", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A/BIN-1", locationType: "bin" });
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A/BIN-2", locationType: "bin" });
		const children = await svc.list({
			warehouseCode: "WH1",
			parentFullPath: "WH1/ZONE-A",
			includeInactive: false,
		});
		expect(children.map((c) => c.code).sort()).toEqual(["BIN-1", "BIN-2"]);
	});

	it("builds a tree of multiple levels", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/AISLE-1",
			locationType: "aisle",
		});
		await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/AISLE-1/BIN-1",
			locationType: "bin",
		});
		await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/AISLE-1/BIN-2",
			locationType: "bin",
		});
		await svc.create({ warehouseCode: "WH1", path: "ZONE-B", locationType: "zone" });

		const tree = await svc.tree("WH1");
		expect(tree.length).toBe(2);
		const zoneA = tree.find((n) => n.code === "ZONE-A");
		expect(zoneA?.children).toHaveLength(1);
		const aisle1 = zoneA?.children[0];
		expect(aisle1?.code).toBe("AISLE-1");
		expect(aisle1?.children.map((c) => c.code).sort()).toEqual(["BIN-1", "BIN-2"]);
	});

	it("archive/unarchive flips isActive", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		expect((await svc.archive("WH1/ZONE-A")).isActive).toBe(false);
		expect((await svc.unarchive("WH1/ZONE-A")).isActive).toBe(true);
	});

	it("delete fails when location has descendants", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/BIN-1",
			locationType: "bin",
		});
		await expect(svc.delete("WH1/ZONE-A")).rejects.toBeInstanceOf(ConflictError);
	});

	it("delete succeeds for leaf", async () => {
		await svc.create({ warehouseCode: "WH1", path: "ZONE-A", locationType: "zone" });
		await svc.create({
			warehouseCode: "WH1",
			path: "ZONE-A/BIN-1",
			locationType: "bin",
		});
		await svc.delete("WH1/ZONE-A/BIN-1");
		expect(await svc.resolveByFullPath("WH1/ZONE-A/BIN-1")).toBeNull();
	});
});
