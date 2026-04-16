import { Command } from "commander";
import { registerBundleCommands } from "./commands/bundle.js";
import { registerDbCommands } from "./commands/db.js";
import { registerLocationCommands } from "./commands/location.js";
import { registerProductCommands } from "./commands/product.js";
import { registerVariantCommands } from "./commands/variant.js";
import { registerWarehouseCommands } from "./commands/warehouse.js";
import type { CliContext } from "./context.js";

export function createProgram(ctx: CliContext): Command {
	const program = new Command();
	program
		.name("inv")
		.description("libSQL + TypeScript CLI inventory management")
		.version("0.1.0")
		.showHelpAfterError();

	registerDbCommands(program, ctx);
	registerProductCommands(program, ctx);
	registerVariantCommands(program, ctx);
	registerBundleCommands(program, ctx);
	registerWarehouseCommands(program, ctx);
	registerLocationCommands(program, ctx);

	return program;
}
