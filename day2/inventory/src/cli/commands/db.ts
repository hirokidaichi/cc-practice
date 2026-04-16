import type { Command } from "commander";
import { getMigrationStatus, resetDatabase, runMigrations } from "../../shared/db/migrator.js";
import type { CliContext } from "../context.js";

export function registerDbCommands(program: Command, ctx: CliContext): void {
	const db = program.command("db").description("database maintenance commands");

	db.command("migrate")
		.description("apply pending migrations")
		.action(async () => {
			const applied = await runMigrations(ctx.db, ctx.migrationsDir, (id) => {
				process.stdout.write(`applied: ${id}\n`);
			});
			if (applied.length === 0) {
				process.stdout.write("no pending migrations\n");
			} else {
				process.stdout.write(`${applied.length} migration(s) applied\n`);
			}
		});

	db.command("status")
		.description("show migration status")
		.action(async () => {
			const status = await getMigrationStatus(ctx.db, ctx.migrationsDir);
			if (ctx.jsonOutput) {
				process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
				return;
			}
			if (status.length === 0) {
				process.stdout.write("(no migrations found)\n");
				return;
			}
			for (const s of status) {
				const mark = s.applied ? "[x]" : "[ ]";
				const suffix = s.appliedAt ? ` (applied ${s.appliedAt})` : "";
				process.stdout.write(`${mark} ${s.id}${suffix}\n`);
			}
		});

	db.command("reset")
		.description("DROP all tables/views (DANGEROUS)")
		.option("--yes", "skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			if (!opts.yes) {
				process.stderr.write("refusing to reset without --yes\n");
				process.exitCode = 4;
				return;
			}
			await resetDatabase(ctx.db);
			process.stdout.write("database reset\n");
		});
}
