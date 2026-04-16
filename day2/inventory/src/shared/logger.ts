export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
	debug(message: string, meta?: Record<string, unknown>): void;
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel): Logger {
	const threshold = ORDER[level];

	function emit(target: LogLevel, message: string, meta?: Record<string, unknown>): void {
		if (ORDER[target] < threshold) return;
		const stream = target === "error" || target === "warn" ? process.stderr : process.stdout;
		const tag = `[${target.toUpperCase()}]`;
		const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
		stream.write(`${tag} ${message}${metaStr}\n`);
	}

	return {
		debug: (msg, meta) => emit("debug", msg, meta),
		info: (msg, meta) => emit("info", msg, meta),
		warn: (msg, meta) => emit("warn", msg, meta),
		error: (msg, meta) => emit("error", msg, meta),
	};
}
