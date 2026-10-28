import { browserHeaders } from "./browser-headers";

const EXTERNAL_VARIABLES_URL =
	"https://www.habbo.com/gamedata/external_variables/1";
const CACHE_TTL = 30 * 60 * 1000;

let gordonCache: { url: string; ts: number } | null = null;

export function __clearGordonCache(): void {
	gordonCache = null;
}

/** Resolve the current Habbo "gordon" asset build URL (trailing slash) from external_variables. */
export async function resolveGordonBuildUrl(): Promise<string> {
	const now = Date.now();
	if (gordonCache && now - gordonCache.ts < CACHE_TTL) return gordonCache.url;
	const res = await fetch(EXTERNAL_VARIABLES_URL, {
		signal: AbortSignal.timeout(20000),
		headers: browserHeaders("document"),
	});
	if (!res.ok)
		throw new Error(`external_variables fetch failed: ${res.status}`);
	const text = await res.text();
	const line = /^flash\.client\.url=(.+)$/m.exec(text)?.[1]?.trim();
	if (!line)
		throw new Error("flash.client.url not found in external_variables");
	const normalized = (line.startsWith("//") ? `https:${line}` : line).replace(
		/\/?$/,
		"/",
	);
	gordonCache = { url: normalized, ts: now };
	return normalized;
}
