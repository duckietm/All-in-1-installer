"use server";

import { like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import {
	type AntiddosBlockTier,
	type AntiddosConfig,
	antiddosConfigToJson,
	antiddosDefaultsFromEnv,
	invalidateAntiddosConfig,
} from "@/lib/antiddos-config";
import {
	removeCloudflareBlock,
	setLastCloudflareVerify,
	verifyCloudflareConnection,
} from "@/lib/cloudflare-api";
import { db, WebsiteSetting } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { redis } from "@/lib/redis";
import { siteSettings } from "@/lib/services/site-settings";

const OVERRIDE_KEY = "antiddos:config";

function str(raw: FormDataEntryValue | null): string {
	return typeof raw === "string" ? raw : "";
}

function positiveInt(raw: FormDataEntryValue | null, fallback: number): number {
	const n = Number(str(raw));
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.floor(n);
}

function parseTiers(raw: FormDataEntryValue | null): AntiddosBlockTier[] {
	const tiers: AntiddosBlockTier[] = [];
	for (const part of str(raw).split(",")) {
		const [minRaw, ttlRaw] = part.split(":");
		const min = Number(minRaw);
		const ttl = Number(ttlRaw);
		if (!Number.isFinite(min) || !Number.isFinite(ttl) || ttl <= 0) continue;
		tiers.push({
			minViolations: Math.max(1, Math.floor(min)),
			ttlSeconds: Math.floor(ttl),
		});
	}
	tiers.sort((a, b) => a.minViolations - b.minViolations);
	return tiers;
}

function configFromForm(formData: FormData): AntiddosConfig {
	const defaults = antiddosDefaultsFromEnv();
	const tierRaw = str(formData.get("block_tiers")).trim();
	return {
		enabled: str(formData.get("enabled")) === "1",
		pages: {
			limit: positiveInt(formData.get("pages_limit"), defaults.pages.limit),
			windowSeconds: positiveInt(
				formData.get("pages_window_sec"),
				defaults.pages.windowSeconds,
			),
		},
		api: {
			limit: positiveInt(formData.get("api_limit"), defaults.api.limit),
			windowSeconds: positiveInt(
				formData.get("api_window_sec"),
				defaults.api.windowSeconds,
			),
		},
		auth: {
			limit: positiveInt(formData.get("auth_limit"), defaults.auth.limit),
			windowSeconds: positiveInt(
				formData.get("auth_window_sec"),
				defaults.auth.windowSeconds,
			),
		},
		global: {
			limit: positiveInt(formData.get("global_limit"), defaults.global.limit),
			windowSeconds: positiveInt(
				formData.get("global_window_sec"),
				defaults.global.windowSeconds,
			),
		},
		violationWindowSeconds: positiveInt(
			formData.get("violation_window_sec"),
			defaults.violationWindowSeconds,
		),
		maxViolations: positiveInt(
			formData.get("max_violations"),
			defaults.maxViolations,
		),
		blockTiers:
			tierRaw.length > 0
				? parseTiers(formData.get("block_tiers"))
				: defaults.blockTiers,
		globalHaltMs: positiveInt(
			formData.get("global_halt_ms"),
			defaults.globalHaltMs,
		),
		cloudflareAutoBlock: str(formData.get("cfa_auto_block")) === "1",
	};
}

async function persistSettings(config: AntiddosConfig): Promise<void> {
	const entries: [string, string][] = [
		["antiddos_enabled", config.enabled ? "1" : "0"],
		["antiddos_pages_limit", String(config.pages.limit)],
		["antiddos_pages_window_sec", String(config.pages.windowSeconds)],
		["antiddos_api_limit", String(config.api.limit)],
		["antiddos_api_window_sec", String(config.api.windowSeconds)],
		["antiddos_auth_limit", String(config.auth.limit)],
		["antiddos_auth_window_sec", String(config.auth.windowSeconds)],
		["antiddos_global_limit", String(config.global.limit)],
		["antiddos_global_window_sec", String(config.global.windowSeconds)],
		["antiddos_violation_window_sec", String(config.violationWindowSeconds)],
		["antiddos_max_violations", String(config.maxViolations)],
		[
			"antiddos_block_tiers",
			config.blockTiers
				.map((t) => `${t.minViolations}:${t.ttlSeconds}`)
				.join(","),
		],
		["antiddos_global_halt_ms", String(config.globalHaltMs)],
		["antiddos_cfa_auto_block", config.cloudflareAutoBlock ? "1" : "0"],
	];
	await Promise.all(
		entries.map(([key, value]) =>
			db
				.insert(WebsiteSetting)
				.values({ key, value, comment: "Anti-DDoS protection" })
				.onDuplicateKeyUpdate({ set: { value } }),
		),
	);
}

/**
 * Save anti-DDoS settings from the admin panel. Persists to site settings
 * (durable across Redis flushes) and pushes the same config to the Redis
 * override the proxy reads, so the change is live within the proxy cache TTL.
 */
export async function saveAntiddosSettings(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const config = configFromForm(formData);

	try {
		await persistSettings(config);
		if (redis) {
			await redis.set(OVERRIDE_KEY, antiddosConfigToJson(config));
		}
		invalidateAntiddosConfig();
		siteSettings.reload();
		logger.info("Anti-DDoS settings updated", {
			staff: staff.username,
			enabled: config.enabled,
		});
	} catch (err) {
		logger.error("Failed to save anti-DDoS settings", { err });
	}
	revalidatePath("/admin/devops/antiddos");
}

/**
 * Revert to the boot defaults (env) — drop the Redis live override and the
 * DB-persisted settings. The gate immediately falls back to env ANTI_DDOS_*.
 */
export async function resetAntiddosSettings(): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);

	try {
		if (redis) await redis.del(OVERRIDE_KEY);
		// Remove every persisted antiddos_* row.
		await db
			.delete(WebsiteSetting)
			.where(like(WebsiteSetting.key, "antiddos_%"));
		invalidateAntiddosConfig();
		siteSettings.reload();
		logger.info("Anti-DDoS settings reset to defaults", {
			staff: staff.username,
		});
	} catch (err) {
		logger.error("Failed to reset anti-DDoS settings", { err });
	}
	revalidatePath("/admin/devops/antiddos");
}

/** Remove a single IP from the temporary DDoS block list. */
export async function unbanAntiddosIp(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const ip = str(formData.get("ip")).trim();
	if (!ip) return;

	try {
		if (redis) {
			await Promise.all([
				redis.del(`antiddos:block:${ip}`),
				redis.del(`antiddos:block:meta:${ip}`),
				redis.del(`antiddos:v:${ip}`),
			]);
		}
		// Also lift a matching Cloudflare edge block (best effort).
		const cloudflare = await removeCloudflareBlock(ip);
		logger.info("Anti-DDoS block manually removed", {
			staff: staff.username,
			ip,
			cloudflareCleared: cloudflare.removed,
		});
	} catch (err) {
		logger.error("Failed to remove anti-DDoS block", { err, ip });
	}
	revalidatePath("/admin/devops/antiddos");
}

/** Remove an automatic Cloudflare edge block for a tracked IP. */
export async function removeCloudflareRule(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const ip = str(formData.get("ip")).trim();
	if (!ip) return;

	const result = await removeCloudflareBlock(ip);
	logger.info(
		result.removed
			? "Cloudflare automatic block removed"
			: "Cloudflare automatic block removal skipped",
		{
			staff: staff.username,
			ip,
			message: result.message,
		},
	);
	revalidatePath("/admin/devops/antiddos");
}

/** Test the configured Cloudflare API credentials against the zone. */
export async function verifyCloudflareConfiguration(): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const status = await verifyCloudflareConnection();
	await setLastCloudflareVerify(status);
	logger.info("Cloudflare API configuration verified", {
		staff: staff.username,
		ok: status.ok,
		zoneName: status.zoneName,
		message: status.message,
	});
	revalidatePath("/admin/devops/antiddos");
}
