import path from "node:path";
import { fileURLToPath } from "node:url";
import { InboundService } from "../modules/inbound/service.js";
import { LocationService } from "../modules/location/service.js";
import { OrderService } from "../modules/order/service.js";
import { OutboundService } from "../modules/outbound/service.js";
import { ProductService } from "../modules/product/service.js";
import { StockService } from "../modules/stock/service.js";
import { VariantService } from "../modules/variant/service.js";
import { WarehouseService } from "../modules/warehouse/service.js";
import { type Config, loadConfig, overrideConfig } from "../shared/config.js";
import { closeDbClient, createDbClient, type DbClient } from "../shared/db/client.js";
import { createLogger, type Logger } from "../shared/logger.js";

export interface CliServices {
	product: ProductService;
	variant: VariantService;
	warehouse: WarehouseService;
	location: LocationService;
	stock: StockService;
	inbound: InboundService;
	outbound: OutboundService;
	order: OrderService;
}

export interface CliContext {
	config: Config;
	db: DbClient;
	logger: Logger;
	migrationsDir: string;
	jsonOutput: boolean;
	services: CliServices;
}

export interface ContextOptions {
	databaseUrl?: string;
	json?: boolean;
	logLevel?: Config["logLevel"];
}

export function resolveMigrationsDir(): string {
	const here = fileURLToPath(import.meta.url);
	// src/cli/context.ts → projectRoot/src/cli → projectRoot
	// dist/cli/context.js → projectRoot/dist/cli → projectRoot
	const projectRoot = path.resolve(path.dirname(here), "..", "..");
	return path.join(projectRoot, "migrations");
}

export async function buildContext(options: ContextOptions = {}): Promise<CliContext> {
	const base = loadConfig();
	const overrides: Partial<Config> = {};
	if (options.databaseUrl !== undefined) overrides.databaseUrl = options.databaseUrl;
	if (options.logLevel !== undefined) overrides.logLevel = options.logLevel;
	const config = Object.keys(overrides).length > 0 ? overrideConfig(base, overrides) : base;

	const db = await createDbClient(config);
	const logger = createLogger(config.logLevel);
	const services: CliServices = {
		product: new ProductService(db),
		variant: new VariantService(db),
		warehouse: new WarehouseService(db),
		location: new LocationService(db),
		stock: new StockService(db),
		inbound: new InboundService(db),
		outbound: new OutboundService(db),
		order: new OrderService(db),
	};
	return {
		config,
		db,
		logger,
		migrationsDir: resolveMigrationsDir(),
		jsonOutput: options.json ?? false,
		services,
	};
}

export async function disposeContext(ctx: CliContext): Promise<void> {
	await closeDbClient(ctx.db);
}
