import { type Client, createClient } from "@libsql/client";
import type { Config } from "../config.js";

export type DbClient = Client;

export async function createDbClient(
	config: Pick<Config, "databaseUrl" | "databaseAuthToken">,
): Promise<DbClient> {
	const client = createClient({
		url: config.databaseUrl,
		...(config.databaseAuthToken ? { authToken: config.databaseAuthToken } : {}),
	});

	await client.execute("PRAGMA foreign_keys = ON");

	const isMemory = config.databaseUrl.includes(":memory:");
	const isLocalFile = config.databaseUrl.startsWith("file:") && !isMemory;
	if (isLocalFile) {
		await client.execute("PRAGMA journal_mode = WAL");
		await client.execute("PRAGMA synchronous = NORMAL");
	}

	return client;
}

export async function closeDbClient(client: DbClient): Promise<void> {
	client.close();
}
