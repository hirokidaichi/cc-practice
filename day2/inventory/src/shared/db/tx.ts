import type { Transaction } from "@libsql/client";
import type { DbClient } from "./client.js";

export type DbExecutor = DbClient | Transaction;

export async function withTransaction<T>(
	client: DbClient,
	fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
	const tx = await client.transaction("write");
	try {
		const result = await fn(tx);
		await tx.commit();
		return result;
	} catch (error) {
		await tx.rollback();
		throw error;
	}
}
