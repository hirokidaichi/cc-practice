import { Command } from "commander";
import { buildContext, disposeContext } from "./context.js";
import { handleCliError } from "./errors.js";
import { createProgram } from "./program.js";

interface GlobalOpts {
	dbUrl?: string;
	json?: boolean;
	debug?: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
	// Pre-parse global options so we can build the context before registering subcommands.
	const preparser = new Command()
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.helpOption(false)
		.addHelpCommand(false)
		.option("--db-url <url>", "libSQL database URL (overrides DATABASE_URL)")
		.option("--json", "emit JSON output")
		.option("--debug", "print stack traces");
	preparser.parse(argv, { from: "user" });
	const opts = preparser.opts<GlobalOpts>();

	if (opts.debug) process.env.DEBUG = "1";

	const ctx = await buildContext({
		...(opts.dbUrl ? { databaseUrl: opts.dbUrl } : {}),
		...(opts.json ? { json: true } : {}),
	});

	try {
		const program = createProgram(ctx);
		program
			.option("--db-url <url>", "libSQL database URL (overrides DATABASE_URL)")
			.option("--json", "emit JSON output")
			.option("--debug", "print stack traces");

		await program.parseAsync(argv, { from: "user" });
	} finally {
		await disposeContext(ctx);
	}
}

main(process.argv.slice(2)).catch(handleCliError);
