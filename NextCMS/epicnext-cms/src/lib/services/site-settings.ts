import "server-only";

import { db, WebsiteSetting } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
	SITE_SETTINGS_MEMORY_TTL_MS,
	SITE_SETTINGS_TTL_MS,
} from "@/lib/perf-ttls";
import { redis } from "@/lib/redis";

const DEFAULTS: Record<string, string> = {
	habbo_imaging_url: "/imaging",
	logo_url: "",
	nitro_client_url: "",
	habbo_gamedata_hotel: "it",
};

const CACHE_TTL_MS = SITE_SETTINGS_TTL_MS;
const REDIS_CACHE_KEY = "site_settings";
// Short in-process window so repeated getters in one request (header, nav,
// footer all read logo and other settings) don't each pay a Redis round-trip.
// Redis stays the source of truth across instances.
const MEMORY_TTL_MS = SITE_SETTINGS_MEMORY_TTL_MS;

// During `next build`, pages are prerendered and `Date.now()` is treated as an
// unstable prerender value — always serve the in-process cache then (settings
// cannot change mid-build). Runtime keeps the normal TTL check.
const IS_PRERENDER =
	process.env.NEXT_PHASE === "phase-production-build" ||
	process.env.NEXT_PHASE === "phase-production-compile";

class SiteSettings {
	private cache: { map: Map<string, string>; expiresAt: number } | null = null;
	// Single-flight: one request (re)loads the map, the rest await it — the
	// root layout reads settings on every render, so concurrent misses must
	// not each hammer Redis/DB (cache-stampede protection).
	private inFlight: Promise<Map<string, string>> | null = null;

	private async loadFromDb(): Promise<Map<string, string> | null> {
		try {
			const rows = await db
				.select({ key: WebsiteSetting.key, value: WebsiteSetting.value })
				.from(WebsiteSetting);
			return new Map(rows.map((r) => [r.key, r.value]));
		} catch {
			logger.warn("Failed to load site settings from database");
			return null;
		}
	}

	private async loadFromCacheOrDb(): Promise<Map<string, string>> {
		if (redis) {
			try {
				const cached = await redis.get(REDIS_CACHE_KEY);
				if (cached) {
					const parsed = JSON.parse(cached) as Record<string, string>;
					const map = new Map(Object.entries(parsed));
					this.cache = { map, expiresAt: Date.now() + MEMORY_TTL_MS };
					return map;
				}
			} catch {
				logger.warn("Redis cache read failed for site settings");
			}
		}

		// Redis miss/unavailable → the database is authoritative. Reloading here
		// (instead of serving the in-process map) is what picks up changes made
		// by other instances after the Redis TTL expires.
		const map = await this.loadFromDb();
		if (map) {
			this.cache = { map, expiresAt: Date.now() + MEMORY_TTL_MS };

			if (redis) {
				try {
					const obj = Object.fromEntries(map.entries());
					await redis.setex(
						REDIS_CACHE_KEY,
						Math.ceil(CACHE_TTL_MS / 1000),
						JSON.stringify(obj),
					);
				} catch {
					logger.warn("Failed to write site settings to Redis cache");
				}
			}

			return map;
		}

		// DB unavailable → keep serving the last known-good map from memory.
		if (this.cache !== null) {
			logger.warn("Site settings: database unreachable, serving stale cache");
			return this.cache.map;
		}

		// Nothing cached in this process and the DB is down → last resort. These
		// defaults are kept in-memory only and never written to Redis, so a
		// momentary DB failure at startup can't poison the shared cache and
		// downgrade every instance to the default/preset branding.
		logger.warn(
			"Site settings: database unreachable and no cached copy, using defaults",
		);
		return new Map(Object.entries(DEFAULTS));
	}

	private async load(): Promise<Map<string, string>> {
		if (this.cache !== null) {
			if (IS_PRERENDER || this.cache.expiresAt > Date.now()) {
				return this.cache.map;
			}
		}

		if (this.inFlight) return this.inFlight;

		const run = this.loadFromCacheOrDb().finally(() => {
			this.inFlight = null;
		});
		this.inFlight = run;
		return run;
	}

	async getAll(): Promise<Map<string, string>> {
		return await this.load();
	}

	async get(
		key: string,
		fallback: string | null = null,
	): Promise<string | null> {
		const map = await this.load();
		if (map.has(key)) return map.get(key) as string;
		// guarded by `key in DEFAULTS`
		if (key in DEFAULTS) return DEFAULTS[key] as string;
		return fallback;
	}

	async getMany(keys: string[]): Promise<Record<string, string | null>> {
		const map = await this.load();
		const result: Record<string, string | null> = {};
		for (const key of keys) {
			result[key] =
				map.get(key) ?? (key in DEFAULTS ? (DEFAULTS[key] as string) : null);
		}
		return result;
	}

	async getBool(key: string, fallback = false): Promise<boolean> {
		const v = await this.get(key, null);
		if (v === null) return fallback;
		const s = v.toLowerCase();
		return s === "1" || s === "true";
	}

	async update(key: string, value: string): Promise<void> {
		await db
			.insert(WebsiteSetting)
			.values({ key, value })
			.onDuplicateKeyUpdate({ set: { value } });
		await this.reload();
	}

	async reload(): Promise<void> {
		this.cache = null;
		this.inFlight = null;
		if (redis) {
			try {
				await redis.del(REDIS_CACHE_KEY);
			} catch {
				logger.warn("Failed to invalidate Redis cache for site settings");
			}
		}
	}
}

export const siteSettings = new SiteSettings();
