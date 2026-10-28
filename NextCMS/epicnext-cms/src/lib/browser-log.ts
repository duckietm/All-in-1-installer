import { reportBrowserError } from "./browser-errors";

/**
 * Browser counterpart of `@/lib/logger` for client components.
 *
 * The server logger pulls in pino, AsyncLocalStorage, node:crypto and the
 * filesystem, so it must never end up in a client bundle. Client components
 * import this module instead — same interface (debug/info/warn/error), but
 * console-based. Errors are also forwarded to the diagnostics endpoint so
 * they surface in housekeeping, and `error()` returns the error reference id.
 */

function formatMeta(meta: Record<string, unknown> = {}): string {
	const keys = Object.keys(meta);
	if (keys.length === 0) return "";
	return keys
		.map((k) => {
			const v = meta[k];
			return `${k}=${v instanceof Error ? v.message : String(v)}`;
		})
		.join(" ");
}

const canReport = typeof window !== "undefined";

export const logger = {
	debug(message: string, meta: Record<string, unknown> = {}): void {
		console.debug(`[debug] ${message} ${formatMeta(meta)}`.trim());
	},
	info(message: string, meta: Record<string, unknown> = {}): void {
		console.info(`[info] ${message} ${formatMeta(meta)}`.trim());
	},
	warn(message: string, meta: Record<string, unknown> = {}): void {
		console.warn(`[warn] ${message} ${formatMeta(meta)}`.trim());
	},
	error(message: string, meta: Record<string, unknown> = {}): string {
		console.error(`[error] ${message} ${formatMeta(meta)}`.trim());
		if (!canReport) return "";
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
		return reportBrowserError(error) ?? "";
	},
};
