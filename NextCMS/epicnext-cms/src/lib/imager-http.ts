import "server-only";

import { createHash } from "node:crypto";

/**
 * Strong HTTP validator for an imaging response body.
 *
 * Derived from the bytes rather than the request URL on purpose: the same URL
 * can legitimately return different bytes over its lifetime — a degraded
 * fallback render before the configured imager recovers, or a different
 * transcode variant — and a URL-based validator would let a browser keep the
 * worse image via a stale `304`. Hashing the body means the ETag changes
 * exactly when the bytes do.
 */
export function strongEtag(body: Uint8Array): string {
	return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * Whether an `If-None-Match` request header matches `etag`. Handles the
 * comma-separated list form, weak validators (`W/"…"`) and the `*` wildcard, so
 * a revalidating browser gets a `304` whenever its cached copy still matches.
 */
export function ifNoneMatchSatisfied(
	header: string | null,
	etag: string,
): boolean {
	if (!header) return false;
	return header.split(",").some((raw) => {
		const tag = raw.trim();
		return tag === "*" || tag === etag || tag === `W/${etag}`;
	});
}
