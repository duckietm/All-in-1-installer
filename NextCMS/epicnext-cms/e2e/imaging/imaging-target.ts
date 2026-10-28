import type { APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Where the imaging specs are pointed.
 *
 * - Deploy gate (`playwright.config.ts`): hits the CMS directly, so the CMS's
 *   own `/imaging` route answers and its transcoding variants are reachable.
 * - Cross-browser job (`playwright.imaging.config.ts` against the public
 *   origin): the edge proxy fronts bare `/imaging` (and `/imaging/*`) to the
 *   imager container, so the CMS route is shadowed. Only the endpoints that are
 *   identical in both topologies may be asserted unconditionally.
 *
 * Set `IMAGING_EDGE=1` when the base URL is behind the edge proxy.
 */
export const IS_EDGE = process.env.IMAGING_EDGE === "1";

/**
 * Failures that mean "the request never reached the app".
 *
 * Cloudflare answers the 520-527 family when its own handshake to the origin
 * fails, and gateways add 502/503/504. Retrying those is not papering over a
 * bug: the assertion under test is about the CMS, and a 525 says nothing about
 * it. A genuinely broken edge still exhausts the retries and fails the test.
 */
const TRANSIENT_EDGE_STATUSES = new Set([
	502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527,
]);
const EDGE_RETRY_ATTEMPTS = 3;
const EDGE_RETRY_DELAY_MS = 500;

async function withEdgeRetry(
	send: () => Promise<APIResponse>,
): Promise<APIResponse> {
	let response = await send();
	for (
		let attempt = 1;
		attempt < EDGE_RETRY_ATTEMPTS &&
		TRANSIENT_EDGE_STATUSES.has(response.status());
		attempt += 1
	) {
		await new Promise((resolve) =>
			setTimeout(resolve, EDGE_RETRY_DELAY_MS * attempt),
		);
		response = await send();
	}
	return response;
}

/** GET that survives a transient edge/transport failure. */
export function getThroughEdge(
	request: APIRequestContext,
	url: string,
	options: Parameters<APIRequestContext["get"]>[1] = {},
): Promise<APIResponse> {
	return withEdgeRetry(() => request.get(url, options));
}

/** POST/OPTIONS/… counterpart of `getThroughEdge`. */
export function fetchThroughEdge(
	request: APIRequestContext,
	url: string,
	options: Parameters<APIRequestContext["fetch"]>[1] = {},
): Promise<APIResponse> {
	return withEdgeRetry(() => request.fetch(url, options));
}

// The exact figure that regressed in production: the game client appends a
// trailing `.<n>` segment that the renderer ignores, but the previous
// validation regex rejected with a 400.
export const FIGURE =
	"hr-11782-40-40.hd-180-7-14.ch-11592-66.lg-10726-79-1408.sh-11764-1408.ha-11958-70-1408.wa-2007-0.0";

export const avatarPath = (params: Record<string, string> = {}) =>
	`/api/imaging/avatar?${new URLSearchParams({ figure: FIGURE, ...params })}`;

/** Public imager endpoint served through the edge proxy (imager container). */
export const IMAGER_PATH = (params: Record<string, string> = {}) =>
	`/imaging/avatarimage?${new URLSearchParams({ figure: FIGURE, ...params })}`;

/** Counts non-overlapping occurrences of `needle` inside `haystack`. */
export function countBytes(haystack: Buffer, needle: Buffer): number {
	let count = 0;
	for (
		let index = haystack.indexOf(needle);
		index !== -1;
		index = haystack.indexOf(needle, index + needle.length)
	) {
		count += 1;
	}
	return count;
}

/** PNG/JPEG/GIF/WebP/AVIF signatures, so a test can prove a body is an image. */
export function looksLikeImage(body: Buffer): boolean {
	if (body.length < 12) return false;
	if (body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
		return true; // PNG / APNG
	if (body.subarray(0, 3).toString("ascii") === "GIF") return true;
	if (body.subarray(0, 2).toString("hex") === "ffd8") return true; // JPEG
	if (body.subarray(0, 4).toString("ascii") === "RIFF") return true; // WebP
	if (body.subarray(4, 12).toString("ascii") === "ftypavif") return true; // AVIF
	return false;
}
