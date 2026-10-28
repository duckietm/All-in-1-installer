import "server-only";
import pino from "pino";
import { env } from "@/env";
import { captureCmsError } from "./error-monitor";
import { getOperationContext } from "./foundation/request-context";

type LogLevel = "debug" | "info" | "warn" | "error";

const level: LogLevel =
	(env.LOG_LEVEL as LogLevel | undefined) ??
	(env.NODE_ENV === "production" ? "info" : "debug");

const isProd = env.NODE_ENV === "production";
const isTest = env.NODE_ENV === "test" || process.env.VITEST === "true";

const pinoLogger = pino({
	level,
	base: { service: "atomcms-next" },
	...(isProd || isTest
		? {}
		: {
				transport: {
					target: "pino-pretty",
					options: { colorize: true, translateTime: "SYS:standard" },
				},
			}),
});

let requestIdCounter = 0;

export function generateRequestId(): string {
	requestIdCounter += 1;
	return `${Date.now().toString(36)}-${requestIdCounter.toString(36)}`;
}

/**
 * Server-side logger — pino with request context, errors are persisted by the
 * CMS error monitor. Client components must use `@/lib/browser-log` instead:
 * this module is guarded by `server-only` and binds pino, AsyncLocalStorage
 * and the filesystem, so it can never be part of a client bundle.
 */
export const logger = {
	debug(message: string, meta: Record<string, unknown> = {}): void {
		pinoLogger.debug({ ...meta, ...getOperationContext() }, message);
	},
	info(message: string, meta: Record<string, unknown> = {}): void {
		pinoLogger.info({ ...meta, ...getOperationContext() }, message);
	},
	warn(message: string, meta: Record<string, unknown> = {}): void {
		pinoLogger.warn({ ...meta, ...getOperationContext() }, message);
	},
	error(message: string, meta: Record<string, unknown> = {}): string {
		const error =
			meta.err instanceof Error
				? meta.err
				: meta.error instanceof Error
					? meta.error
					: new Error(
							typeof meta.err === "string"
								? meta.err
								: typeof meta.error === "string"
									? meta.error
									: message,
						);
		const operation = getOperationContext();
		const context = { ...operation, ...meta, ...operation };
		const errorId = captureCmsError("server", message, error, context);
		pinoLogger.error({ ...context, errorId }, message);
		return errorId;
	},
};
