import { describe, expect, it } from "vitest";
import { splitStatements } from "./migrator.js";

describe("splitStatements", () => {
	it("splits simple statements on semicolons", () => {
		const sql = "CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER);";
		expect(splitStatements(sql)).toEqual([
			"CREATE TABLE a (id INTEGER)",
			"CREATE TABLE b (id INTEGER)",
		]);
	});

	it("strips line comments", () => {
		const sql = `-- first comment
			CREATE TABLE a (id INTEGER); -- trailing
			-- another
			CREATE TABLE b (id INTEGER);
		`;
		const stmts = splitStatements(sql);
		expect(stmts).toHaveLength(2);
		expect(stmts[0]).toContain("CREATE TABLE a");
		expect(stmts[1]).toContain("CREATE TABLE b");
	});

	it("filters empty segments", () => {
		const sql = ";\n-- nothing here\n  ;\n";
		expect(splitStatements(sql)).toEqual([]);
	});

	it("preserves multi-line statements", () => {
		const sql = `CREATE TABLE products (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL
		);`;
		const stmts = splitStatements(sql);
		expect(stmts).toHaveLength(1);
		expect(stmts[0]).toContain("id INTEGER PRIMARY KEY");
		expect(stmts[0]).toContain("name TEXT NOT NULL");
	});
});
