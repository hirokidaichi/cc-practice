import { ExitCode } from "./exit-codes.js";

export type DomainErrorCode = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN";

const codeToExit: Record<DomainErrorCode, ExitCode> = {
	VALIDATION: ExitCode.Validation,
	NOT_FOUND: ExitCode.NotFound,
	CONFLICT: ExitCode.Conflict,
	FORBIDDEN: ExitCode.Forbidden,
};

export class DomainError extends Error {
	readonly code: DomainErrorCode;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "DomainError";
		this.code = code;
		this.details = details;
	}

	get exitCode(): ExitCode {
		return codeToExit[this.code];
	}
}

export class NotFoundError extends DomainError {
	constructor(resource: string, keyValue: string | number) {
		super("NOT_FOUND", `${resource} not found: ${keyValue}`, { resource, keyValue });
		this.name = "NotFoundError";
	}
}

export class ConflictError extends DomainError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("CONFLICT", message, details);
		this.name = "ConflictError";
	}
}

export class ValidationError extends DomainError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("VALIDATION", message, details);
		this.name = "ValidationError";
	}
}
