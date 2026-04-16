import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDbClient, createDbClient, type DbClient } from "../../src/shared/db/client.js";
import { runMigrations } from "../../src/shared/db/migrator.js";

export interface TestDb {
	db: DbClient;
	migrationsDir: string;
	cleanup: () => Promise<void>;
}

export function resolveMigrationsDir(): string {
	const here = fileURLToPath(import.meta.url);
	return path.resolve(path.dirname(here), "..", "..", "migrations");
}

async function makeTempDbUrl(): Promise<{ url: string; dir: string }> {
	const dir = await mkdtemp(path.join(tmpdir(), "inv-test-"));
	return { url: `file:${path.join(dir, "test.db")}`, dir };
}

export async function createTestDb(): Promise<TestDb> {
	const { url, dir } = await makeTempDbUrl();
	const db = await createDbClient({ databaseUrl: url });
	const migrationsDir = resolveMigrationsDir();
	await runMigrations(db, migrationsDir);
	return {
		db,
		migrationsDir,
		cleanup: async () => {
			await closeDbClient(db);
			await rm(dir, { recursive: true, force: true });
		},
	};
}

export async function createEmptyTestDb(): Promise<TestDb> {
	const { url, dir } = await makeTempDbUrl();
	const db = await createDbClient({ databaseUrl: url });
	return {
		db,
		migrationsDir: resolveMigrationsDir(),
		cleanup: async () => {
			await closeDbClient(db);
			await rm(dir, { recursive: true, force: true });
		},
	};
}
