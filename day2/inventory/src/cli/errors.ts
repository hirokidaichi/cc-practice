import { ZodError } from "zod";
import { DomainError } from "../shared/errors/domain-error.js";
import { ExitCode } from "../shared/errors/exit-codes.js";

export function formatZodError(error: ZodError): string {
	const issues = error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `  - ${path}: ${issue.message}`;
	});
	return `Validation failed:\n${issues.join("\n")}`;
}

export function handleCliError(error: unknown): never {
	if (error instanceof ZodError) {
		process.stderr.write(`${formatZodError(error)}\n`);
		process.exit(ExitCode.Validation);
	}
	if (error instanceof DomainError) {
		process.stderr.write(`[${error.code}] ${error.message}\n`);
		if (error.details && process.env.DEBUG) {
			process.stderr.write(`  details: ${JSON.stringify(error.details)}\n`);
		}
		process.exit(error.exitCode);
	}
	if (error instanceof Error) {
		process.stderr.write(`Error: ${error.message}\n`);
		if (process.env.DEBUG) {
			process.stderr.write(`${error.stack ?? ""}\n`);
		}
		process.exit(ExitCode.Unknown);
	}
	process.stderr.write(`Unknown error: ${String(error)}\n`);
	process.exit(ExitCode.Unknown);
}
