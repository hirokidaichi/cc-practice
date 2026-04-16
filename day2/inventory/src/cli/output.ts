export function emit(ctx: { jsonOutput: boolean }, data: unknown): void {
	if (ctx.jsonOutput) {
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}
	if (data === null || data === undefined) return;
	if (typeof data === "string") {
		process.stdout.write(`${data}\n`);
		return;
	}
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function emitTable(
	ctx: { jsonOutput: boolean },
	rows: Record<string, unknown>[],
	columns: string[],
): void {
	if (ctx.jsonOutput) {
		emit(ctx, rows);
		return;
	}
	if (rows.length === 0) {
		process.stdout.write("(no rows)\n");
		return;
	}
	const widths = columns.map((c) =>
		Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
	);
	const header = columns.map((c, i) => c.padEnd(widths[i] ?? c.length)).join("  ");
	const sep = columns.map((_, i) => "-".repeat(widths[i] ?? 1)).join("  ");
	process.stdout.write(`${header}\n${sep}\n`);
	for (const r of rows) {
		const line = columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i] ?? 0)).join("  ");
		process.stdout.write(`${line}\n`);
	}
}
