import "server-only";

import { env } from "@/env";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { UNKNOWN_CLIENT_IP } from "./client-ip";

/**
 * Cloudflare API integration for the anti-DDoS gate.
 *
 * When the gate escalates an IP into a host-level block it also mirrors the
 * block to the zone's IP Access Rules (`firewall/access_rules/rules`) so
 * repeat offenders are dropped at the Cloudflare edge. IP Access Rules are
 * the classic per-IP firewall; they carry a `notes` string we use for
 * tracking. The rules themselves have no TTL, so expiry is enforced here:
 * each auto-created rule is recorded in Redis (meta + index) and the
 * `sweepExpiredCloudflareBlocks` job (or the admin page) removes the rule
 * once its block duration has passed.
 *
 * Credentials come from env only (`CLOUDFLARE_API_TOKEN`,
 * `CLOUDFLARE_ZONE_ID`) and are never written into the admin-visible config.
 */

export class CloudflareApiError extends Error {}

export interface CloudflareApiConfig {
	baseUrl: string;
	token: string | null;
	zoneId: string | null;
}

export interface CloudflareConnectionStatus {
	ok: boolean;
	zoneId?: string;
	zoneName?: string;
	message?: string;
	at: number;
}

export interface CloudflareBlockMeta {
	ruleId: string;
	ip: string;
	ttlSeconds: number;
	createdAt: number;
	category: string;
}

export interface CloudflareBlockView extends CloudflareBlockMeta {
	remainingSeconds: number;
	expired: boolean;
}

const API_TIMEOUT_MS = 15_000;
const META_PREFIX = "antiddos:cfa:";
const INDEX_KEY = `${META_PREFIX}index`;
const LOCK_PREFIX = `${META_PREFIX}lock:`;
const LAST_VERIFY_KEY = `${META_PREFIX}last-verify`;
/** Marker written into the CF rule `notes` so we can identify our own rules. */
export const CLOUDFLARE_BLOCK_NOTE_PREFIX = "atom-nexst anti-ddos auto-block";

export function getCloudflareApiConfig(): CloudflareApiConfig {
	return {
		baseUrl:
			env.CLOUDFLARE_API_BASE_URL || "https://api.cloudflare.com/client/v4",
		token: env.CLOUDFLARE_API_TOKEN?.trim() || null,
		zoneId: env.CLOUDFLARE_ZONE_ID?.trim() || null,
	};
}

/** True when a token + zone id are present so the gate may call the API. */
export function cloudflareEnabled(): boolean {
	const config = getCloudflareApiConfig();
	return Boolean(config.token && config.zoneId);
}

interface CloudflareEnvelope<T> {
	success: boolean;
	errors?: { code: number; message: string }[];
	result: T;
}

function firstError<T>(envelope: CloudflareEnvelope<T>): string {
	return envelope.errors?.[0]?.message ?? "Unknown Cloudflare API error";
}

/** Max duration a CF IP Access Rule block may live. Blocks use the gate's per-tier TTL. */
export const MAX_CLOUDFLARE_BLOCK_TTL_SECONDS = 86_400 * 7;

async function cloudflareRequest<T>(
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<CloudflareEnvelope<T>> {
	const config = getCloudflareApiConfig();
	if (!config.token) {
		throw new CloudflareApiError("CLOUDFLARE_API_TOKEN is not configured");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
	let response: Response | undefined;
	try {
		response = await fetch(`${config.baseUrl}${path}`, {
			method: init.method ?? "GET",
			headers: {
				Authorization: `Bearer ${config.token}`,
				"Content-Type": "application/json",
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: controller.signal,
			cache: "no-store",
		});
	} finally {
		clearTimeout(timer);
	}

	let envelope: CloudflareEnvelope<T>;
	try {
		envelope = (await response.json()) as CloudflareEnvelope<T>;
	} catch {
		throw new CloudflareApiError(
			`Cloudflare API returned HTTP ${response.status} with a non-JSON body`,
		);
	}
	if (!response.ok || !envelope.success) {
		throw new CloudflareApiError(
			`Cloudflare API error (HTTP ${response.status}): ${firstError(envelope)}`,
		);
	}
	return envelope;
}

/** Validate that the configured token can read the zone. */
export async function verifyCloudflareConnection(): Promise<CloudflareConnectionStatus> {
	const config = getCloudflareApiConfig();
	if (!config.token) {
		return {
			ok: false,
			message: "CLOUDFLARE_API_TOKEN is not configured",
			at: Date.now(),
		};
	}
	if (!config.zoneId) {
		return {
			ok: false,
			message: "CLOUDFLARE_ZONE_ID is not configured",
			at: Date.now(),
		};
	}
	try {
		const zone = await cloudflareRequest<{ id: string; name: string }>(
			`/zones/${encodeURIComponent(config.zoneId)}`,
		);
		return {
			ok: true,
			zoneId: config.zoneId,
			zoneName: zone.result.name,
			at: Date.now(),
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error ? error.message : "Cloudflare API unavailable",
			at: Date.now(),
		};
	}
}

/**
 * Purge specific URLs from the Cloudflare edge cache (POST purge_cache).
 * At most 30 URLs are allowed per call by the API; split larger batches.
 */
export async function purgeCacheByUrls(
	urls: string[],
): Promise<{ purged: number }> {
	const config = getCloudflareApiConfig();
	if (!config.zoneId) {
		throw new CloudflareApiError("CLOUDFLARE_ZONE_ID is not configured");
	}
	const zoneId: string = config.zoneId;
	if (urls.length === 0) return { purged: 0 };
	const envelopes = await Promise.all(
		chunk(urls, 30).map((files) =>
			cloudflareRequest<{ id: string }>(
				`/zones/${encodeURIComponent(zoneId)}/purge_cache`,
				{ method: "POST", body: { files } },
			),
		),
	);
	return { purged: envelopes.length };
}

/**
 * Purge every cached response that carried one of the given Cache-Tag values
 * (the tags nginx emits in the `Cache-Tag` header). This is the cheap, exact
 * way to drop the public API / gamedata / client edge cache after a CMS edit
 * or deploy, without touching unrelated cached objects.
 */
export async function purgeCacheByTags(
	tags: string[],
): Promise<{ purged: number }> {
	const config = getCloudflareApiConfig();
	if (!config.zoneId) {
		throw new CloudflareApiError("CLOUDFLARE_ZONE_ID is not configured");
	}
	const zoneId: string = config.zoneId;
	if (tags.length === 0) return { purged: 0 };
	const envelopes = await Promise.all(
		chunk(tags, 30).map((tagGroup) =>
			cloudflareRequest<{ id: string }>(
				`/zones/${encodeURIComponent(zoneId)}/purge_cache`,
				{ method: "POST", body: { tags: tagGroup } },
			),
		),
	);
	return { purged: envelopes.length };
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

async function createIpRule(
	ip: string,
	ttlSeconds: number,
	category: string,
): Promise<{ ruleId: string }> {
	const config = getCloudflareApiConfig();
	if (!config.zoneId) {
		throw new CloudflareApiError("CLOUDFLARE_ZONE_ID is not configured");
	}
	const envelope = await cloudflareRequest<{ id: string }>(
		`/zones/${encodeURIComponent(config.zoneId)}/firewall/access_rules/rules`,
		{
			method: "POST",
			body: {
				mode: "block",
				configuration: { target: "ip", value: ip },
				notes: `${CLOUDFLARE_BLOCK_NOTE_PREFIX} ttl=${ttlSeconds}s category=${category}`,
			},
		},
	);
	return { ruleId: envelope.result.id };
}

async function deleteIpRule(ruleId: string): Promise<void> {
	const config = getCloudflareApiConfig();
	if (!config.zoneId) {
		throw new CloudflareApiError("CLOUDFLARE_ZONE_ID is not configured");
	}
	await cloudflareRequest<void>(
		`/zones/${encodeURIComponent(config.zoneId)}/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`,
		{ method: "DELETE" },
	);
}

// --- Coordination state (Redis backed, in-process fallback) ---

interface BlockStore {
	get(ip: string): Promise<CloudflareBlockMeta | null>;
	set(meta: CloudflareBlockMeta): Promise<void>;
	delete(ip: string): Promise<void>;
	list(): Promise<string[]>;
	/**
	 * Claim a short-lived per-IP lock. Returns true when this caller may
	 * create the edge rule (no other instance is mid-flight for the IP).
	 */
	lock(ip: string): Promise<boolean>;
}

function metaKey(ip: string): string {
	return `${META_PREFIX}${ip}`;
}

const redisStore: BlockStore = {
	async get(ip) {
		if (!redis) return null;
		const raw = await redis.get(metaKey(ip));
		if (!raw) return null;
		try {
			return JSON.parse(raw) as CloudflareBlockMeta;
		} catch {
			return null;
		}
	},
	async set(meta) {
		if (!redis) return;
		await Promise.all([
			redis.set(metaKey(meta.ip), JSON.stringify(meta)),
			redis.sadd(INDEX_KEY, meta.ip),
		]);
	},
	async delete(ip) {
		if (!redis) return;
		await Promise.all([redis.del(metaKey(ip)), redis.srem(INDEX_KEY, ip)]);
	},
	async list() {
		if (!redis) return [];
		return redis.smembers(INDEX_KEY);
	},
	async lock(ip) {
		if (!redis) return true;
		const acquired = await redis.set(LOCK_PREFIX + ip, "1", "EX", 30, "NX");
		return acquired === "OK";
	},
};

const memoryBlocks = new Map<string, CloudflareBlockMeta>();

const memoryStore: BlockStore = {
	async get(ip) {
		return memoryBlocks.get(ip) ?? null;
	},
	async set(meta) {
		memoryBlocks.set(meta.ip, meta);
	},
	async delete(ip) {
		memoryBlocks.delete(ip);
	},
	async list() {
		return [...memoryBlocks.keys()];
	},
	async lock() {
		return true;
	},
};

function activeStore(): BlockStore {
	return redis ? redisStore : memoryStore;
}

function isBlockExpired(meta: CloudflareBlockMeta): boolean {
	return Date.now() - meta.createdAt >= meta.ttlSeconds * 1000;
}

/**
 * Mirror an escalated IP block to Cloudflare. Safe to call on the hot path:
 * it is never awaited by the caller, does nothing when the Cloudflare API is
 * not configured or the runtime toggle is off, and dedupes per IP until the
 * block expires. Any API failure is logged and swallowed.
 */
export async function maybeAutoBlockCloudflare(input: {
	ip: string;
	ttlSeconds: number;
	category: string;
	enabled: boolean;
}): Promise<void> {
	const { ip, ttlSeconds, category, enabled } = input;
	if (!enabled) return;
	if (!cloudflareEnabled()) return;
	if (!ip || ip === UNKNOWN_CLIENT_IP) return;

	try {
		const store = activeStore();
		const existing = await store.get(ip);
		if (existing && !isBlockExpired(existing)) return;

		if (existing) {
			try {
				await deleteIpRule(existing.ruleId);
			} catch (error) {
				logger.warn(
					"[cloudflare-api] Could not refresh stale edge block — re-creating",
					{ ip, err: error },
				);
			}
		}

		if (!(await store.lock(ip))) return;

		// Double-check after claiming the lock (another instance may have won).
		const recheck = await store.get(ip);
		if (recheck && !isBlockExpired(recheck)) return;

		const { ruleId } = await createIpRule(ip, ttlSeconds, category);
		await store.set({
			ruleId,
			ip,
			ttlSeconds,
			category,
			createdAt: Date.now(),
		});
		logger.info("[cloudflare-api] Automatic IP block created", {
			ip,
			ruleId,
			ttlSeconds,
			category,
		});
	} catch (error) {
		logger.error("[cloudflare-api] Automatic IP block failed", {
			ip,
			err: error,
		});
	}
}

/**
 * Delete the Cloudflare edge block for an IP (used by the admin "unban" and
 * the sweep job). Local tracking is only cleared after the API confirms the
 * rule is gone, so a transient API failure keeps the rule + ttl bookkeeping
 * intact and the next sweep retries.
 */
export async function removeCloudflareBlock(
	ip: string,
): Promise<{ removed: boolean; message?: string }> {
	const store = activeStore();
	const meta = await store.get(ip);
	if (!meta) return { removed: false };

	try {
		await deleteIpRule(meta.ruleId);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Cloudflare API unavailable";
		return { removed: false, message };
	}
	await store.delete(ip);
	logger.info("[cloudflare-api] Automatic IP block removed", {
		ip,
		ruleId: meta.ruleId,
	});
	return { removed: true };
}

/** Current tracked Cloudflare edge blocks, closest to expiry first. */
export async function listCloudflareBlocks(): Promise<CloudflareBlockView[]> {
	const store = activeStore();
	const ips = await store.list();
	const blocks = (
		await Promise.all(
			ips.map(async (ip) => {
				const meta = await store.get(ip);
				if (!meta) return null;
				const remainingSeconds = Math.max(
					0,
					Math.ceil(meta.ttlSeconds - (Date.now() - meta.createdAt) / 1000),
				);
				return {
					...meta,
					remainingSeconds,
					expired: isBlockExpired(meta),
				};
			}),
		)
	)
		.filter((block): block is CloudflareBlockView => block !== null)
		.sort((a, b) => a.remainingSeconds - b.remainingSeconds);
	// Drop any orphaned index entries (a meta missing its rule).
	for (const ip of ips) {
		if (!blocks.some((block) => block.ip === ip)) {
			await store.delete(ip);
		}
	}
	return blocks;
}

/**
 * Remove Cloudflare edge blocks whose TTL has elapsed. Runs periodically from
 * the instrumentation worker and from the admin panel render.
 */
export async function sweepExpiredCloudflareBlocks(): Promise<number> {
	const store = activeStore();
	const ips = await store.list();
	let removed = 0;
	for (const ip of ips) {
		const meta = await store.get(ip);
		if (!meta || !isBlockExpired(meta)) continue;
		const result = await removeCloudflareBlock(ip);
		if (result.removed) removed += 1;
	}
	return removed;
}

let lastVerifyMemory: CloudflareConnectionStatus | null = null;

export async function getLastCloudflareVerify(): Promise<CloudflareConnectionStatus | null> {
	if (redis) {
		try {
			const raw = await redis.get(LAST_VERIFY_KEY);
			if (raw) return JSON.parse(raw) as CloudflareConnectionStatus;
		} catch {
			// fall back to in-process view
		}
	}
	return lastVerifyMemory;
}

export async function setLastCloudflareVerify(
	status: CloudflareConnectionStatus,
): Promise<void> {
	lastVerifyMemory = status;
	if (redis) {
		try {
			await redis.set(LAST_VERIFY_KEY, JSON.stringify(status));
		} catch {
			// redis unavailable — in-process view is enough
		}
	}
}

/** Test hook only — drop in-memory dedupe state between unit runs. */
export function resetCloudflareAutoBlockCache(): void {
	memoryBlocks.clear();
}
