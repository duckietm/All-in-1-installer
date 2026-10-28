import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import {
	badgeCacheDir,
	imagingCacheKey,
	readImagingCache,
	writeImagingCache,
} from "@/lib/imager-cache";
import { ifNoneMatchSatisfied, strongEtag } from "@/lib/imager-http";
import { resolveBadgeBase } from "@/lib/runtime-asset-config";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * GET /cms_api/imaging/badge?code=ADM[&source=local]
 *
 * Resolves a Habbo badge code to its image and serves it through a local
 * caching proxy. Candidates are tried in order (configured CDN, public Habbo
 * CDN, local `/swf` copy), so a flaky images.habbo.com never blanks a badge
 * and every badge renders exactly once anywhere on the site.
 */

const CODE_RE = /^[A-Za-z0-9_+.-]+$/;
const CODE_MAX_LEN = 50;
const DEFAULT_BASE = "https://images.habbo.com/c_images/album1584";
const LOCAL_SWF_BASE = "/swf/c_images/album1584";
const GEDATA_IMAGES_BASE = "/var/www/Gamedata/c_images/album1584";
const FETCH_TIMEOUT_MS = 5_000;

// Neutral placeholder (grey rounded square) served as a 200 so broken badge
// glyphs can never appear, even when every candidate is unavailable.
const BADGE_PLACEHOLDER_SVG =
	"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 25'><rect width='40' height='25' rx='4' fill='%23e2e2e2'/></svg>";

type BadgeSource = "upstream" | "local" | "cache" | "unavailable";

interface ResolvedBadge {
	body: Uint8Array;
	contentType: string;
	source: BadgeSource;
}

/**
 * Concurrent cold-cache requests for the same badge would otherwise each walk
 * the whole candidate list, and when the first candidate is a slow/unreachable
 * CDN that means every one of them waits out the fetch timeout before falling
 * back. Sharing a single resolution keeps a cold cache from stacking identical
 * upstream work. Held on globalThis because Next can evaluate this module more
 * than once per process.
 */
const globalForBadgeFetches = globalThis as typeof globalThis & {
	imagingBadgeFetches?: Map<string, Promise<ResolvedBadge>>;
};
const inFlight =
	globalForBadgeFetches.imagingBadgeFetches ??
	new Map<string, Promise<ResolvedBadge>>();
globalForBadgeFetches.imagingBadgeFetches = inFlight;

async function resolveBadge(
	cacheKey: string,
	code: string,
	candidates: string[],
): Promise<ResolvedBadge> {
	const pending = inFlight.get(cacheKey);
	if (pending) return pending;

	const work = (async (): Promise<ResolvedBadge> => {
		for (const base of candidates) {
			const result = await fetchCandidate(base, code);
			if (result) {
				await writeImagingCache(
					badgeCacheDir(),
					cacheKey,
					result.body,
					result.contentType,
				);
				return result;
			}
		}
		return {
			body: new TextEncoder().encode(BADGE_PLACEHOLDER_SVG),
			contentType: "image/svg+xml",
			source: "unavailable",
		};
	})();

	inFlight.set(cacheKey, work);
	try {
		return await work;
	} finally {
		if (inFlight.get(cacheKey) === work) inFlight.delete(cacheKey);
	}
}

export async function GET(request: NextRequest) {
	const code = request.nextUrl.searchParams.get("code")?.trim();
	if (!code || code.length > CODE_MAX_LEN || !CODE_RE.test(code)) {
		return NextResponse.json({ error: "Invalid badge code" }, { status: 400 });
	}

	const configured = (
		(resolveBadgeBase() || (await siteSettings.get("badge_base_url", ""))) ??
		""
	).trim();
	const sourceLocal = request.nextUrl.searchParams.get("source") === "local";

	const candidates: string[] = sourceLocal
		? [LOCAL_SWF_BASE, GEDATA_IMAGES_BASE, DEFAULT_BASE]
		: [
				...((configured && [configured]) as string[]),
				DEFAULT_BASE,
				GEDATA_IMAGES_BASE,
				LOCAL_SWF_BASE,
			];

	const cacheKey = imagingCacheKey(`${code}\n${candidates.join("\n")}`);
	const cached = await readImagingCache(badgeCacheDir(), cacheKey);
	if (cached)
		return badgeResponse(
			cached.body,
			cached.contentType,
			"cache",
			request.headers.get("if-none-match"),
		);

	const resolved = await resolveBadge(cacheKey, code, candidates);
	return badgeResponse(
		resolved.body,
		resolved.contentType,
		resolved.source,
		request.headers.get("if-none-match"),
	);
}

async function fetchCandidate(
	base: string,
	code: string,
): Promise<{
	body: Uint8Array;
	contentType: string;
	source: BadgeSource;
} | null> {
	const normalized = base.replace(/\/+$/, "");
	if (/^https?:\/\//i.test(normalized)) {
		try {
			const res = await fetch(`${normalized}/${encodeURIComponent(code)}.gif`, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				cache: "no-store",
			});
			if (!res.ok) return null;
			const contentType = res.headers.get("content-type") ?? "image/gif";
			if (!contentType.startsWith("image/")) return null;
			return {
				body: new Uint8Array(await res.arrayBuffer()),
				contentType,
				source: "upstream",
			};
		} catch {
			return null;
		}
	}

	// Local `/swf/...` path — read straight from the deployed public folder.
	if (normalized.startsWith("/swf")) {
		try {
			const file = join(
				process.cwd(),
				"public",
				normalized.replace(/^\//, ""),
				`${code}.gif`,
			);
			const body = new Uint8Array(await readFile(file));
			return { body, contentType: "image/gif", source: "local" };
		} catch {
			return null;
		}
	}

	// Local Gamedata path — read from /var/www/Gamedata/c_images/album1584/
	if (normalized.startsWith("/var/www/Gamedata")) {
		try {
			const file = join(normalized, `${code}.gif`);
			const body = new Uint8Array(await readFile(file));
			return { body, contentType: "image/gif", source: "local" };
		} catch {
			return null;
		}
	}

	return null;
}

function badgeResponse(
	body: Uint8Array,
	contentType: string,
	source: BadgeSource,
	ifNoneMatch: string | null = null,
) {
	const etag = strongEtag(body);
	const cacheControl =
		source === "unavailable" ? "no-cache, max-age=0" : "public, max-age=3600";
	// Same bytes the client already has: skip the body. Validators are hashed
	// from the body, so a fallback→upstream swap still forces a fresh 200.
	if (ifNoneMatchSatisfied(ifNoneMatch, etag)) {
		return new NextResponse(null, {
			status: 304,
			headers: {
				ETag: etag,
				"Cache-Control": cacheControl,
				"X-Imager-Source": source,
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
	return new NextResponse(body as unknown as BodyInit, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(body.length),
			"Cache-Control": cacheControl,
			ETag: etag,
			"X-Imager-Source": source,
			"Access-Control-Allow-Origin": "*",
		},
	});
}

export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, If-None-Match",
		},
	});
}
