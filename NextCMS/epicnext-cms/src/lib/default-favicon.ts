import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/**
 * The bundled default favicon (public/favicon.svg) as a base64 data URI.
 * Read once and memoized; only used when no custom favicon is configured.
 */
export function getDefaultFaviconDataUri(): string {
	if (cached) return cached;
	const raw = readFileSync(join(process.cwd(), "public", "favicon.svg"));
	cached = `data:image/svg+xml;base64,${raw.toString("base64")}`;
	return cached;
}
