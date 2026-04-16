export const ExitCode = {
	Success: 0,
	Unknown: 1,
	Validation: 2,
	NotFound: 3,
	Conflict: 4,
	Forbidden: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
