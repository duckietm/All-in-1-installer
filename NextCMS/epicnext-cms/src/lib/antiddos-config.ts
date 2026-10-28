import "server-only";

import { env } from "@/env";
import { redis } from "@/lib/redis";

export interface AntiddosCategoryConfig {
	limit: number;
	windowSeconds: number;
}

export interface AntiddosBlockTier {
	minViolations: number;
	ttlSeconds: number;
}

export interface AntiddosConfig {
	enabled: boolean;
	pages: AntiddosCategoryConfig;
	api: AntiddosCategoryConfig;
	auth: AntiddosCategoryConfig;
	global: AntiddosCategoryConfig;
	violationWindowSeconds: number;
	maxViolations: number;
	blockTiers: AntiddosBlockTier[];
	globalHaltMs: number;
	cloudflareAutoBlock: boolean;
}

const DEFAULT_CONFIG: AntiddosConfig = {
	enabled: true,
	pages: { limit: 300, windowSeconds: 60 },
	api: { limit: 600, windowSeconds: 60 },
	auth: { limit: 20, windowSeconds: 60 },
	global: { limit: 18_000, windowSeconds: 60 },
	violationWindowSeconds: 600,
	maxViolations: 10,
	blockTiers: [
		{ minViolations: 5, ttlSeconds: 600 },
		{ minViolations: 20, ttlSeconds: 3_600 },
		{ minViolations: 50, ttlSeconds: 86_400 },
	],
	globalHaltMs: 10_000,
	cloudflareAutoBlock: true,
};

function positiveInt(value: number | undefined, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.floor(n);
}

function parseTiers(raw: string | undefined): AntiddosBlockTier[] | null {
	if (!raw?.trim()) return null;
	const tiers: AntiddosBlockTier[] = [];
	for (const part of raw.split(",")) {
		const [minRaw, ttlRaw] = part.split(":");
		const min = Number(minRaw);
		const ttl = Number(ttlRaw);
		if (!Number.isFinite(min) || !Number.isFinite(ttl) || ttl <= 0) return null;
		tiers.push({
			minViolations: Math.max(1, Math.floor(min)),
			ttlSeconds: ttl,
		});
	}
	if (tiers.length === 0) return null;
	tiers.sort((a, b) => a.minViolations - b.minViolations);
	return tiers;
}

/**
 * Gate on a boolean-flag env value that is either already transformed to a
 * real boolean (production schema) or still a raw string (SKIP-env tests).
 */
function isTruthyFlag(value: string | boolean | undefined): boolean {
	return !(value === false || value === "false" || value === "0");
}

/** Boot defaults from environment (explicitly set → overrides code; unset → sane value). */
export function antiddosDefaultsFromEnv(): AntiddosConfig {
	const tiers = parseTiers(env.ANTI_DDOS_BLOCK_TIERS);
	return {
		enabled: isTruthyFlag(env.ANTI_DDOS_ENABLED),
		pages: {
			limit: positiveInt(env.ANTI_DDOS_PAGES_LIMIT, DEFAULT_CONFIG.pages.limit),
			windowSeconds: positiveInt(
				env.ANTI_DDOS_PAGES_WINDOW_SEC,
				DEFAULT_CONFIG.pages.windowSeconds,
			),
		},
		api: {
			limit: positiveInt(env.ANTI_DDOS_API_LIMIT, DEFAULT_CONFIG.api.limit),
			windowSeconds: positiveInt(
				env.ANTI_DDOS_API_WINDOW_SEC,
				DEFAULT_CONFIG.api.windowSeconds,
			),
		},
		auth: {
			limit: positiveInt(env.ANTI_DDOS_AUTH_LIMIT, DEFAULT_CONFIG.auth.limit),
			windowSeconds: positiveInt(
				env.ANTI_DDOS_AUTH_WINDOW_SEC,
				DEFAULT_CONFIG.auth.windowSeconds,
			),
		},
		global: {
			limit: positiveInt(
				env.ANTI_DDOS_GLOBAL_LIMIT,
				DEFAULT_CONFIG.global.limit,
			),
			windowSeconds: positiveInt(
				env.ANTI_DDOS_GLOBAL_WINDOW_SEC,
				DEFAULT_CONFIG.global.windowSeconds,
			),
		},
		violationWindowSeconds: positiveInt(
			env.ANTI_DDOS_VIOLATION_WINDOW_SEC,
			DEFAULT_CONFIG.violationWindowSeconds,
		),
		maxViolations: positiveInt(
			env.ANTI_DDOS_MAX_VIOLATIONS,
			DEFAULT_CONFIG.maxViolations,
		),
		blockTiers: tiers ?? DEFAULT_CONFIG.blockTiers,
		globalHaltMs: positiveInt(
			env.ANTI_DDOS_GLOBAL_HALT_MS,
			DEFAULT_CONFIG.globalHaltMs,
		),
		cloudflareAutoBlock: isTruthyFlag(env.CLOUDFLARE_AUTO_BLOCK_ENABLED),
	};
}

const OVERRIDE_KEY = "antiddos:config";
const MEMORY_TTL_MS = 30_000;
const ABSENT_CACHE_MS = 30_000;

let cachedAt = 0;
let cachedConfig: AntiddosConfig | null = null;

function sanitize(config: AntiddosConfig): AntiddosConfig {
	const base = antiddosDefaultsFromEnv();
	const cat = (
		c: AntiddosCategoryConfig,
		fallback: AntiddosCategoryConfig,
	): AntiddosCategoryConfig => ({
		limit: positiveInt(c?.limit, fallback.limit),
		windowSeconds: positiveInt(c?.windowSeconds, fallback.windowSeconds),
	});
	return {
		enabled: Boolean(config?.enabled),
		pages: cat(config?.pages, base.pages),
		api: cat(config?.api, base.api),
		auth: cat(config?.auth, base.auth),
		global: cat(config?.global, base.global),
		violationWindowSeconds: positiveInt(
			config?.violationWindowSeconds,
			base.violationWindowSeconds,
		),
		maxViolations: positiveInt(config?.maxViolations, base.maxViolations),
		blockTiers:
			Array.isArray(config?.blockTiers) && config.blockTiers.length > 0
				? config.blockTiers
						.filter((t) => t && t.ttlSeconds > 0)
						.map((t) => ({
							minViolations: positiveInt(t.minViolations, 1),
							ttlSeconds: positiveInt(t.ttlSeconds, 600),
						}))
						.sort((a, b) => a.minViolations - b.minViolations)
				: base.blockTiers,
		globalHaltMs: positiveInt(config?.globalHaltMs, base.globalHaltMs),
		cloudflareAutoBlock: config?.cloudflareAutoBlock !== false,
	};
}

/**
 * Effective anti-DDoS configuration. The admin panel writes the full JSON to
 * the Redis `antiddos:config` key (and mirrors it into site settings for
 * durability); the proxy reads it with a short in-process TTL so the running
 * deployment picks changes up quickly. On Redis miss it returns the env-derived
 * boot defaults.
 */
export async function getAntiddosConfig(): Promise<AntiddosConfig> {
	const now = Date.now();
	if (cachedConfig !== null && now - cachedAt < MEMORY_TTL_MS) {
		return cachedConfig;
	}

	if (redis) {
		try {
			const raw = await redis.get(OVERRIDE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<AntiddosConfig>;
				const config = sanitize(parsed as AntiddosConfig);
				cachedConfig = config;
				cachedAt = now;
				return config;
			}
		} catch {
			// fall through to env defaults; stale in-process config kept serving.
		}
	}

	if (now - cachedAt < ABSENT_CACHE_MS && cachedConfig !== null) {
		return cachedConfig;
	}

	const config = antiddosDefaultsFromEnv();
	cachedConfig = config;
	cachedAt = now;
	return config;
}

/** Reset the in-process view (after the admin writes a new config). */
export function invalidateAntiddosConfig(): void {
	cachedConfig = null;
	cachedAt = 0;
}

/**
 * Serialize the live config for the `antiddos:config` value the admin persists
 * and the proxy consumes.
 */
export function antiddosConfigToJson(config: AntiddosConfig): string {
	return JSON.stringify(config);
}
