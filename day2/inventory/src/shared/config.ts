import { z } from "zod";

const ConfigSchema = z.object({
	databaseUrl: z.string().min(1),
	databaseAuthToken: z.string().optional(),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const raw = {
		databaseUrl: env.DATABASE_URL ?? "file:./inv.db",
		databaseAuthToken: env.DATABASE_AUTH_TOKEN || undefined,
		logLevel: env.LOG_LEVEL ?? "info",
	};
	return ConfigSchema.parse(raw);
}

export function overrideConfig(base: Config, overrides: Partial<Config>): Config {
	return ConfigSchema.parse({ ...base, ...overrides });
}
