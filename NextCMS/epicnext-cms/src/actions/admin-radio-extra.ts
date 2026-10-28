"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, RadioBanners, RadioRanks, WebsiteSetting } from "@/lib/db";
import { isSafeOutboundUrl } from "@/lib/import-url-safety";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse a FormData field into a positive BigInt id, or null when invalid. */
function parseId(raw: FormDataEntryValue | null): bigint | null {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	try {
		const id = BigInt(raw.trim());
		return id > 0n ? id : null;
	} catch {
		return null;
	}
}

function str(raw: FormDataEntryValue | null): string {
	return typeof raw === "string" ? raw : "";
}

/** Checkbox/select truthiness: '1', 'true', 'on' → true. */
function bool(raw: FormDataEntryValue | null): boolean {
	const v = str(raw).trim().toLowerCase();
	return v === "1" || v === "true" || v === "on";
}

// ── Radio settings (website_settings radio_* keys) ─────────────────────────

/**
 * Upsert one radio_* website_settings key. Mirrors AtomCMS's
 * RadioSettings Filament page (key/value rows in website_settings). Busts the
 * siteSettings cache so the public radio pages pick the change up immediately.
 */
export async function saveRadioSetting(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const key = str(formData.get("key")).trim().slice(0, 255);
	const value = str(formData.get("value"));
	const comment = str(formData.get("comment")).trim().slice(0, 255);
	// Radio rights cover radio settings only, not any website setting (staff 2FA, ranks, secrets).
	if (!key || !(key.startsWith("radio_") || key.startsWith("auto_dj_"))) return;
	// The server fetches the provider API URLs: refuse ones that reach this server or the local network.
	if (
		key.endsWith("_api_url") &&
		value &&
		!(await isSafeOutboundUrl(value, { allowHttp: true }))
	) {
		logger.warn("Radio API URL refused: private or local address", { key });
		return;
	}

	try {
		await db
			.insert(WebsiteSetting)
			.values({ key, value, comment: comment || null })
			.onDuplicateKeyUpdate({ set: { value } });
		siteSettings.reload();
	} catch (err) {
		logger.error("Failed to save radio setting", { err, key });
	}
	revalidatePath("/admin/radio/settings");
}

/**
 * Bulk-save every radio_* field submitted by the settings form in one pass.
 * The form posts a hidden `__keys` field listing the keys it rendered so we
 * only touch those (and never wipe unrelated settings).
 */
export async function saveRadioSettings(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const keysRaw = str(formData.get("__keys"));
	const keys = keysRaw
		.split(",")
		.map((k) => k.trim())
		.filter((k) => k.startsWith("radio_") || k.startsWith("auto_dj_"));
	if (keys.length === 0) return;

	// The server fetches the provider API URLs: refuse ones that reach this server or the local network.
	const unsafe = new Set<string>();
	for (const key of keys) {
		const value = str(formData.get(key));
		if (
			key.endsWith("_api_url") &&
			value &&
			!(await isSafeOutboundUrl(value, { allowHttp: true }))
		) {
			unsafe.add(key);
		}
	}
	if (unsafe.size > 0) {
		logger.warn("Radio API URL refused: private or local address", {
			keys: [...unsafe],
		});
	}

	try {
		await Promise.all(
			keys
				.filter((key) => !unsafe.has(key))
				.map((key) => {
					const value = str(formData.get(key));
					return db
						.insert(WebsiteSetting)
						.values({ key, value, comment: null })
						.onDuplicateKeyUpdate({ set: { value } });
				}),
		);
		siteSettings.reload();
	} catch (err) {
		logger.error("Failed to bulk-save radio settings", { err, keys });
	}
	revalidatePath("/admin/radio/settings");
}

// ── Radio banners CRUD (radio_banners) ─────────────────────────────────────

export async function createRadioBanner(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);
	const imagePath = str(formData.get("imagePath")).trim().slice(0, 255);
	if (!imagePath) return;

	const title = str(formData.get("title")).trim().slice(0, 255);
	const description = str(formData.get("description")).trim();
	const sortOrderNum = Number(str(formData.get("sortOrder")));
	const sortOrder = Number.isFinite(sortOrderNum)
		? Math.trunc(sortOrderNum)
		: 0;
	const isActive = bool(formData.get("isActive"));
	const now = new Date();

	try {
		await db.insert(RadioBanners).values({
			userId: BigInt(staff.id),
			imagePath,
			title: title || null,
			description: description || null,
			sortOrder,
			isActive,
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		logger.error("Failed to create radio banner", { err, imagePath });
	}
	revalidatePath("/admin/radio/banners");
}

export async function updateRadioBanner(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	const imagePath = str(formData.get("imagePath")).trim().slice(0, 255);
	const title = str(formData.get("title")).trim().slice(0, 255);
	const description = str(formData.get("description")).trim();
	const sortOrderNum = Number(str(formData.get("sortOrder")));
	const sortOrder = Number.isFinite(sortOrderNum)
		? Math.trunc(sortOrderNum)
		: 0;
	const isActive = bool(formData.get("isActive"));
	if (!imagePath) return;

	try {
		await db
			.update(RadioBanners)
			.set({
				imagePath,
				title: title || null,
				description: description || null,
				sortOrder,
				isActive,
				updatedAt: new Date(),
			})
			.where(eq(RadioBanners.id, id));
	} catch (err) {
		logger.error("Failed to update radio banner", { err, id: String(id) });
	}
	revalidatePath("/admin/radio/banners");
}

export async function deleteRadioBanner(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;
	try {
		await db.delete(RadioBanners).where(eq(RadioBanners.id, id));
	} catch (err) {
		logger.error("Failed to delete radio banner", { err, id: String(id) });
	}
	revalidatePath("/admin/radio/banners");
}

// ── Radio ranks CRUD (radio_ranks) ─────────────────────────────────────────

export async function createRadioRank(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const name = str(formData.get("name")).trim().slice(0, 255);
	if (!name) return;

	const description = str(formData.get("description")).trim().slice(0, 255);
	const badgeCode = str(formData.get("badgeCode")).trim().slice(0, 255);
	const isActive = bool(formData.get("isActive"));
	const now = new Date();

	try {
		await db.insert(RadioRanks).values({
			name,
			description: description || null,
			badgeCode: badgeCode || null,
			isActive,
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		logger.error("Failed to create radio rank", { err, name });
	}
	revalidatePath("/admin/radio/ranks");
}

export async function updateRadioRank(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	const name = str(formData.get("name")).trim().slice(0, 255);
	const description = str(formData.get("description")).trim().slice(0, 255);
	const badgeCode = str(formData.get("badgeCode")).trim().slice(0, 255);
	const isActive = bool(formData.get("isActive"));
	if (!name) return;

	try {
		await db
			.update(RadioRanks)
			.set({
				name,
				description: description || null,
				badgeCode: badgeCode || null,
				isActive,
				updatedAt: new Date(),
			})
			.where(eq(RadioRanks.id, id));
	} catch (err) {
		logger.error("Failed to update radio rank", { err, id: String(id) });
	}
	revalidatePath("/admin/radio/ranks");
}

export async function deleteRadioRank(formData: FormData): Promise<void> {
	await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;
	try {
		await db.delete(RadioRanks).where(eq(RadioRanks.id, id));
	} catch (err) {
		logger.error("Failed to delete radio rank", { err, id: String(id) });
	}
	revalidatePath("/admin/radio/ranks");
}
