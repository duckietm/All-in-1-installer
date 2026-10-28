import "server-only";

import {
	AVATAR_FIGURE_MAX_LEN as FIGURE_MAX_LEN,
	AVATAR_FIGURE_MAX_PARTS as FIGURE_MAX_PARTS,
	AVATAR_FIGURE_RE as FIGURE_RE,
} from "@/lib/avatar-figure";
import {
	avatarCacheDir,
	imagingCacheKey,
	readImagingCache,
	writeImagingCache,
} from "@/lib/imager-cache";
import { resolveImagerBase } from "@/lib/runtime-asset-config";

// The client's figure strings are passed straight through to the imager, which
// is the authority on what it can draw. The rules live in `avatar-figure.ts` so
// the URL builder applies the exact same ones; the parser only enforces them.
export { FIGURE_MAX_LEN, FIGURE_MAX_PARTS, FIGURE_RE };

const HABBO_PUBLIC_UPSTREAM = "https://www.habbo.com/habbo-imaging/avatarimage";

// Effect renders (the client asks for effect=14 by default) are encoded as
// APNG animations and consistently need a little over 4s, so the primary
// budget has to stay well above that or every effected avatar times out. The
// public Habbo renderer is a best-effort safety net only: it is slow to fail,
// so it gets a short budget and the disk cache absorbs the difference.
export const PRIMARY_TIMEOUT_MS = 8_000;
export const FALLBACK_TIMEOUT_MS = 2_000;

// Keyed by cache key, so one render serves every concurrent request for the same
// figure. Held on globalThis because Next can evaluate this module more than once
// per process (multiple server bundles); separate copies would each start their
// own render and defeat the point entirely.
const globalForRenders = globalThis as typeof globalThis & {
	imagingInFlight?: Map<
		string,
		{ startedAt: number; render: Promise<ImagerResult> }
	>;
};
const inFlight =
	globalForRenders.imagingInFlight ??
	new Map<string, { startedAt: number; render: Promise<ImagerResult> }>();
globalForRenders.imagingInFlight = inFlight;

const MAX_IN_FLIGHT_RENDERS = 256;

// How long a newcomer is willing to queue behind a render somebody else started.
//
// Sharing one render across concurrent requests is what keeps a cold cache from
// launching N renders, but it also means a render that hangs holds up everyone
// who arrives after it rather than only itself. Past this point a new caller
// stops joining and serves the placeholder instead: the render in flight is
// still worth finishing for the request that asked for it, but it must not be
// able to stall an unbounded queue behind it. Callers that arrive inside the
// window are the normal case — a render that takes longer than this is already
// heading for its 8s timeout and would return a degraded image anyway.
const RENDER_JOIN_WINDOW_MS = 2_000;

export type ImagerSource =
	| "primary"
	| "fallback"
	| "cache"
	| "cache-stale"
	| "unavailable";

export interface ImagerResult {
	body: Uint8Array;
	contentType: string;
	source: ImagerSource;
}

export type AvatarQuery =
	| { ok: true; params: URLSearchParams }
	| { ok: false; message: string };

export class ImagerUnavailableError extends Error {
	constructor(message = "Avatar imager unavailable") {
		super(message);
		this.name = "ImagerUnavailableError";
	}
}

export function parseAvatarQuery(searchParams: URLSearchParams): AvatarQuery {
	const figure = (
		searchParams.get("figure") ??
		searchParams.get("look") ??
		""
	).trim();
	if (!figure) return { ok: false, message: "Missing figure parameter" };
	if (figure.length > FIGURE_MAX_LEN || !FIGURE_RE.test(figure))
		return { ok: false, message: "Invalid figure format" };
	if (figure.split(".").length > FIGURE_MAX_PARTS)
		return { ok: false, message: "Figure has too many parts" };

	const sizeParam = searchParams.get("size");
	const size: "s" | "m" | "l" =
		sizeParam === "s" || sizeParam === "l" ? sizeParam : "m";

	const direction = clampInt(searchParams.get("direction"), 0, 7, 2);
	const headDirection = clampInt(
		searchParams.get("head_direction") ?? searchParams.get("headDirection"),
		0,
		7,
		3,
	);
	const headOnly =
		searchParams.get("headonly") === "1" ||
		searchParams.get("headOnly") === "1";
	const gesture = searchParams.get("gesture") ?? undefined;
	const action = searchParams.get("action") ?? undefined;
	const effect = searchParams.get("effect") ?? undefined;

	const params = new URLSearchParams({
		figure,
		direction: String(direction),
		head_direction: String(headDirection),
		size,
		img_format: "png",
	});
	if (headOnly) params.set("headonly", "1");
	if (gesture) params.set("gesture", gesture);
	if (action) params.set("action", action);
	if (effect) params.set("effect", effect);

	const imgFormat = searchParams.get("img_format");
	if (imgFormat) params.set("img_format", imgFormat);

	return { ok: true, params };
}

export async function fetchAvatarImage(
	origin: string,
	params: URLSearchParams,
): Promise<ImagerResult> {
	const primary = resolveImagerBase(origin);

	// Renders are immutable per figure/variant: serve a previously cached
	// render without touching the upstream at all. This keeps repeated avatar
	// requests off the local renderer and survives upstream downtime.
	const cacheKey = imagingCacheKey(`${primary}\n${params.toString()}`);
	const cached = await readImagingCache(avatarCacheDir(), cacheKey);
	if (cached) return { ...cached, source: "cache" };

	// Single-flight a render. A page requests dozens of avatars at once and
	// repeats figures, so without this a cold cache turns N concurrent requests
	// for one figure into N upstream renders — the most expensive operation in
	// the app, launched exactly when the cache has nothing to offer. The winner
	// writes to the disk cache; the others wait for that one result.
	const pending = inFlight.get(cacheKey);
	if (pending) {
		if (Date.now() - pending.startedAt < RENDER_JOIN_WINDOW_MS)
			return pending.render;
		// The shared render has been going too long to be worth joining. Fall
		// through to the placeholder rather than extending an unbounded queue.
		throw new ImagerUnavailableError(
			"Avatar render already in progress too long",
		);
	}

	// Defensive bound: entries are removed as soon as they settle, so this only
	// matters if renders are somehow never cleaned up.
	if (inFlight.size >= MAX_IN_FLIGHT_RENDERS) inFlight.clear();
	const entry = {
		startedAt: Date.now(),
		render: renderAvatar(primary, cacheKey, params),
	};
	inFlight.set(cacheKey, entry);
	try {
		return await entry.render;
	} finally {
		if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
	}
}

async function renderAvatar(
	primary: string,
	cacheKey: string,
	params: URLSearchParams,
): Promise<ImagerResult> {
	const primaryResult = await fetchUpstream(
		primary,
		params,
		PRIMARY_TIMEOUT_MS,
	);
	if (primaryResult) {
		await writeImagingCache(
			avatarCacheDir(),
			cacheKey,
			primaryResult.body,
			primaryResult.contentType,
		);
		return { ...primaryResult, source: "primary" };
	}

	if (isSameUpstream(primary, HABBO_PUBLIC_UPSTREAM)) {
		throw new ImagerUnavailableError(
			"Configured imager is already the fallback upstream",
		);
	}

	const fallbackResult = await fetchUpstream(
		HABBO_PUBLIC_UPSTREAM,
		buildFallbackParams(params),
		FALLBACK_TIMEOUT_MS,
	);
	// Deliberately not cached: a fallback render drops the effect and is only a
	// degraded stand-in, so persisting it would keep serving the worse image
	// for the whole cache lifetime. The local renderer caches its own renders,
	// so the next request for this figure is cheap and returns the real one.
	if (fallbackResult) {
		return { ...fallbackResult, source: "fallback" };
	}

	// Both upstreams are down and nothing was cached before. Try once more
	// against the cache in case a concurrent request just wrote this render,
	// then give up so the caller can serve a graceful placeholder.
	const recent = await readImagingCache(avatarCacheDir(), cacheKey);
	if (recent) return { ...recent, source: "cache-stale" };

	throw new ImagerUnavailableError();
}

async function fetchUpstream(
	baseUrl: string,
	params: URLSearchParams,
	timeoutMs: number,
): Promise<Omit<ImagerResult, "source"> | null> {
	const url = new URL(baseUrl);
	for (const [key, value] of params) url.searchParams.set(key, value);

	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			cache: "no-store",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			},
		});
		if (!res.ok) return null;
		return {
			body: new Uint8Array(await res.arrayBuffer()),
			contentType: res.headers.get("content-type") || "image/png",
		};
	} catch {
		return null;
	}
}

function buildFallbackParams(params: URLSearchParams): URLSearchParams {
	const fallback = new URLSearchParams(params);
	// The public Habbo renderer has no effect rendering support.
	fallback.delete("effect");
	// The public Habbo renderer emits PNG/GIF, not APNG.
	fallback.set("img_format", "png");
	return fallback;
}

function isSameUpstream(a: string, b: string): boolean {
	const normalize = (value: string) =>
		value.replace(/\/+$/, "").replace(/^https?:/, "");
	return normalize(a) === normalize(b);
}

function clampInt(
	raw: string | null,
	min: number,
	max: number,
	fallback: number,
): number {
	if (raw == null) return fallback;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n) || n < min || n > max) return fallback;
	return n;
}
