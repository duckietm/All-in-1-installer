import { NextResponse } from "next/server";

/**
 * JSON response helper for the public REST API. Serialises BigInt (DB ids)
 * to strings — JSON.stringify throws on BigInt otherwise — and sets CORS to
 * APP_URL so the game client / external integrations can read it.
 */
const CORS_ORIGIN = process.env.APP_URL ?? "http://localhost:3000";

/**
 * Opt a response in to HTTP caching.
 *
 * The default is deliberately `no-store`: most routes here are personalised,
 * admin-only, or auth-dependent, and caching any of those would be a data leak.
 * A route may only pass this when its body is fully public and identical for
 * every caller.
 *
 * `s-maxage` is what lets a shared cache (the CDN in front of this app) answer
 * without the request reaching the app at all; `max-age` covers the browser.
 * `stale-while-revalidate` lets that cache keep serving the previous body while
 * it refreshes, which is the same trade-off the in-process cache makes.
 */
export function publicCacheControl(seconds: number): string {
	return `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=${seconds}`;
}

export function apiJson(data: unknown, init?: ResponseInit): NextResponse {
	const body = JSON.stringify(data, (_k, v) =>
		typeof v === "bigint" ? v.toString() : v,
	);
	return new NextResponse(body, {
		status: init?.status ?? 200,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"access-control-allow-origin": CORS_ORIGIN,
			"cache-control": "no-store",
			...(init?.headers ?? {}),
		},
	});
}

/** Standard success envelope: { ok: true, ...data }. */
export function apiOk(
	data?: Record<string, unknown>,
	init?: ResponseInit,
): NextResponse {
	return apiJson({ ok: true, ...data }, init);
}

/** Standard error envelope. */
export function apiError(message: string, status = 400): NextResponse {
	return apiJson({ error: message }, { status });
}

/** Safe response for temporary infrastructure failures. */
export function apiUnavailable(
	message = "Service temporarily unavailable",
): NextResponse {
	return apiError(message, 503);
}

/** Parse an unsigned, non-zero database identifier without Number precision loss. */
export function positiveBigInt(raw: string | null): bigint | null {
	if (!raw || !/^\d+$/.test(raw)) return null;
	const value = BigInt(raw);
	return value > 0n ? value : null;
}

/** Clamp a ?page / ?perPage pair from search params. */
export function pagination(
	searchParams: URLSearchParams,
	defaultPer = 20,
	maxPer = 100,
) {
	const requestedPage = positiveInteger(searchParams.get("page"), 1);
	const requestedPerPage = positiveInteger(
		searchParams.get("perPage"),
		defaultPer,
	);
	const perPage = Math.min(maxPer, requestedPerPage);
	const maxSafePage = Math.floor(Number.MAX_SAFE_INTEGER / perPage) + 1;
	const page = Math.min(requestedPage, maxSafePage);
	return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

function positiveInteger(raw: string | null, fallback: number): number {
	if (!raw || !/^\d+$/.test(raw)) return fallback;
	const value = Number(raw);
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
