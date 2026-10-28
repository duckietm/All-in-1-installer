import "server-only";

import { env } from "@/env";

/**
 * Env-tuned cache TTLs for the hot public/admin read paths. Every value falls
 * back to the previous hard-coded default when the variable is unset (and under
 * SKIP_ENV_VALIDATION, where env is the raw process.env), so existing installs
 * behave identically until they opt into tuning.
 *
 * Keep these in seconds on the wire (env) and milliseconds in code, matching
 * the REDIS_CACHE_TTL_DEFAULT convention.
 */
function seconds(
	value: string | number | undefined,
	fallbackSec: number,
): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSec) * 1000;
}

/** `/api/home` landing payload (articles + online count + hotel name). */
export const HOME_PAYLOAD_TTL_MS = seconds(env.CMS_HOME_PAYLOAD_TTL_SEC, 15);

/** Shared news preview list used by the homepage and widgets. */
export const NEWS_LIST_TTL_MS = seconds(env.CMS_NEWS_LIST_TTL_SEC, 300);

/** News archive / search landing — includes a COUNT(*) over a LIKE scan. */
export const NEWS_ARCHIVE_TTL_MS = seconds(env.CMS_NEWS_ARCHIVE_TTL_SEC, 60);

/** Public directory search sections (users/rooms/news/events). */
export const PUBLIC_SEARCH_TTL_MS = seconds(env.CMS_SEARCH_TTL_SEC, 30);

/** Online player counter — the hottest COUNT(*) on the site. */
export const ONLINE_COUNT_TTL_MS = seconds(env.CMS_ONLINE_COUNT_TTL_SEC, 10);

/** Public counter keys (totals) and the warm-up's stale window for them. */
export const COUNTERS_TTL_MS = seconds(env.CMS_COUNTERS_TTL_SEC, 300);

/** Site settings: Redis/shared TTL and the per-process memory mirror. */
export const SITE_SETTINGS_TTL_MS = seconds(env.CMS_SITE_SETTINGS_TTL_SEC, 300);
export const SITE_SETTINGS_MEMORY_TTL_MS = seconds(
	env.CMS_SITE_SETTINGS_MEMORY_TTL_SEC,
	60,
);

/** Boot-time cache warm-up toggle (instrumentation.ts). */
export const CACHE_WARMUP_ENABLED = (() => {
	// Validated mode exposes the zod-transformed boolean; SKIP_ENV_VALIDATION
	// (tooling/tests) hands the raw string through, so accept both spellings.
	const raw = env.CMS_WARMUP_ENABLED as unknown;
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") return raw !== "false" && raw !== "0";
	return true;
})();
