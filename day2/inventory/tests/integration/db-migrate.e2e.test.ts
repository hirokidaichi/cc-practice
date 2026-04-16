import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMigrationStatus, runMigrations } from "../../src/shared/db/migrator.js";
import { createEmptyTestDb, type TestDb } from "../helpers/test-db.js";

describe("db migrate", () => {
	let ctx: TestDb;

	beforeEach(async () => {
		ctx = await createEmptyTestDb();
	});

	afterEach(async () => {
		await ctx.cleanup();
	});

	it("applies pending migrations on first run", async () => {
		const applied = await runMigrations(ctx.db, ctx.migrationsDir);
		expect(applied).toContain("0001_init_masters");
	});

	it("is idempotent on second run", async () => {
		await runMigrations(ctx.db, ctx.migrationsDir);
		const applied = await runMigrations(ctx.db, ctx.migrationsDir);
		expect(applied).toEqual([]);
	});

	it("reports migration status correctly", async () => {
		const before = await getMigrationStatus(ctx.db, ctx.migrationsDir);
		expect(before.every((s) => !s.applied)).toBe(true);

		await runMigrations(ctx.db, ctx.migrationsDir);

		const after = await getMigrationStatus(ctx.db, ctx.migrationsDir);
		expect(after.every((s) => s.applied)).toBe(true);
		for (const s of after) expect(s.appliedAt).toBeTruthy();
	});

	it("creates the expected master tables", async () => {
		await runMigrations(ctx.db, ctx.migrationsDir);
		const rs = await ctx.db.execute(
			"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
		);
		const tables = rs.rows.map((r) => String(r.name));
		for (const expected of [
			"_migrations",
			"bundle_components",
			"categories",
			"customers",
			"locations",
			"product_variants",
			"products",
			"suppliers",
			"warehouses",
		]) {
			expect(tables).toContain(expected);
		}
	});

	it("enforces variant_type check constraint", async () => {
		await runMigrations(ctx.db, ctx.migrationsDir);
		await ctx.db.execute({
			sql: "INSERT INTO products (code, name) VALUES (?, ?)",
			args: ["PRD-1", "test"],
		});
		await expect(
			ctx.db.execute({
				sql: "INSERT INTO product_variants (product_id, sku, variant_type, unit_price) VALUES (?, ?, ?, ?)",
				args: [1, "SKU-1", "invalid_type", 100],
			}),
		).rejects.toThrow();
	});

	it("enforces unique sku on product_variants", async () => {
		await runMigrations(ctx.db, ctx.migrationsDir);
		await ctx.db.execute({
			sql: "INSERT INTO products (code, name) VALUES (?, ?)",
			args: ["PRD-1", "test"],
		});
		await ctx.db.execute({
			sql: "INSERT INTO product_variants (product_id, sku, variant_type, unit_price) VALUES (?, ?, ?, ?)",
			args: [1, "SKU-A", "simple", 100],
		});
		await expect(
			ctx.db.execute({
				sql: "INSERT INTO product_variants (product_id, sku, variant_type, unit_price) VALUES (?, ?, ?, ?)",
				args: [1, "SKU-A", "simple", 200],
			}),
		).rejects.toThrow();
	});

	it("cascades product deletion to variants", async () => {
		await runMigrations(ctx.db, ctx.migrationsDir);
		await ctx.db.execute({
			sql: "INSERT INTO products (code, name) VALUES (?, ?)",
			args: ["PRD-1", "test"],
		});
		await ctx.db.execute({
			sql: "INSERT INTO product_variants (product_id, sku, variant_type, unit_price) VALUES (?, ?, ?, ?)",
			args: [1, "SKU-A", "simple", 100],
		});
		await ctx.db.execute({ sql: "DELETE FROM products WHERE id = ?", args: [1] });
		const rs = await ctx.db.execute("SELECT COUNT(*) AS c FROM product_variants");
		expect(Number(rs.rows[0]?.c)).toBe(0);
	});
});
