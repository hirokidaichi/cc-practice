import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DbClient } from "./client.js";

export interface Migration {
	id: string;
	filePath: string;
}

export interface MigrationStatus {
	id: string;
	applied: boolean;
	appliedAt: string | null;
}

async function ensureMigrationsTable(client: DbClient): Promise<void> {
	await client.execute(
		`CREATE TABLE IF NOT EXISTS _migrations (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
	);
}

export async function listMigrations(migrationsDir: string): Promise<Migration[]> {
	const files = await readdir(migrationsDir);
	const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
	return sqlFiles.map((f) => ({
		id: f.replace(/\.sql$/, ""),
		filePath: join(migrationsDir, f),
	}));
}

async function fetchApplied(client: DbClient): Promise<Map<string, string>> {
	const rs = await client.execute("SELECT id, applied_at FROM _migrations");
	const map = new Map<string, string>();
	for (const row of rs.rows) {
		map.set(String(row.id), String(row.applied_at));
	}
	return map;
}

function stripLineComments(sql: string): string {
	return sql
		.split("\n")
		.map((line) => {
			const idx = line.indexOf("--");
			return idx >= 0 ? line.slice(0, idx) : line;
		})
		.join("\n");
}

export function splitStatements(sql: string): string[] {
	const cleaned = stripLineComments(sql);
	return cleaned
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export async function runMigrations(
	client: DbClient,
	migrationsDir: string,
	onApply?: (id: string) => void,
): Promise<string[]> {
	await ensureMigrationsTable(client);
	const applied = await fetchApplied(client);
	const migrations = await listMigrations(migrationsDir);
	const toApply = migrations.filter((m) => !applied.has(m.id));
	const appliedIds: string[] = [];

	for (const m of toApply) {
		const sql = await readFile(m.filePath, "utf8");
		const statements = splitStatements(sql);
		const tx = await client.transaction("write");
		try {
			for (const stmt of statements) {
				await tx.execute(stmt);
			}
			await tx.execute({
				sql: "INSERT INTO _migrations (id) VALUES (?)",
				args: [m.id],
			});
			await tx.commit();
			appliedIds.push(m.id);
			onApply?.(m.id);
		} catch (err) {
			await tx.rollback();
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to apply migration ${m.id}: ${msg}`);
		}
	}

	return appliedIds;
}

export async function getMigrationStatus(
	client: DbClient,
	migrationsDir: string,
): Promise<MigrationStatus[]> {
	await ensureMigrationsTable(client);
	const applied = await fetchApplied(client);
	const migrations = await listMigrations(migrationsDir);
	return migrations.map((m) => ({
		id: m.id,
		applied: applied.has(m.id),
		appliedAt: applied.get(m.id) ?? null,
	}));
}

export async function resetDatabase(client: DbClient): Promise<void> {
	const rs = await client.execute(
		"SELECT name FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%'",
	);
	const objects = rs.rows.map((r) => ({
		name: String(r.name),
	}));

	await client.execute("PRAGMA foreign_keys = OFF");
	try {
		for (const obj of objects) {
			await client.execute(`DROP TABLE IF EXISTS "${obj.name}"`);
		}
		await client.execute("DROP VIEW IF EXISTS v_bundle_availability");
	} finally {
		await client.execute("PRAGMA foreign_keys = ON");
	}
}
