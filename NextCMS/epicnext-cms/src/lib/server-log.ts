import { logger } from "@/lib/logger";

type LogScalar = string | number | boolean | null;
type LogContext = Record<string, unknown>;

const SENSITIVE_KEY =
	/(authorization|cookie|password|secret|token|api[-_]?key)/i;

export interface ServerErrorRecord {
	level: "error";
	event: string;
	message: string;
	context: Record<string, LogScalar>;
}

export function serverErrorRecord(
	event: string,
	error: unknown,
	context: LogContext = {},
): ServerErrorRecord {
	return {
		level: "error",
		event,
		message:
			error instanceof Error
				? error.message.slice(0, 500)
				: "Unknown server error",
		context: Object.fromEntries(
			Object.entries(context).map(([key, value]) => [
				key,
				SENSITIVE_KEY.test(key) ? "[REDACTED]" : logScalar(value),
			]),
		),
	};
}

export function logServerError(
	event: string,
	error: unknown,
	context: LogContext = {},
): string {
	return logger.error(event, {
		...serverErrorRecord(event, error, context).context,
		err: error,
	});
}

function logScalar(value: unknown): LogScalar {
	return typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? value
		: value === null
			? null
			: "[NON_SCALAR]";
}
