"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MANAGED_SETTING_KEYS } from "@/app/admin/settings/cms-settings-config";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { actionOk, adminAction } from "@/lib/foundation/action";
import {
	HABBO_GAMEDATA_HOTEL_SETTING_KEY,
	normalizeHabboGamedataHotel,
} from "@/lib/habbo-gamedata-hotel";
import { PERMS } from "@/lib/permissions";
import { clearOfficialHabboFurnidataCache } from "@/lib/services/habbo-furnidata-cache";
import { clearBadgeCache } from "@/lib/services/habboassets";
import {
	isSecretSettingKey,
	SECRET_PLACEHOLDER,
} from "@/lib/services/setting-secrets";
import { siteSettings } from "@/lib/services/site-settings";

const managedKeySet = new Set(MANAGED_SETTING_KEYS);

// Raw keys only the CMS core is allowed to own. Writing an arbitrary key from
// the generic "advanced key/value" form previously meant a staff member could
// overwrite `turnstile_secret`, `force_staff_2fa` or `min_staff_rank`.
const RAW_SETTING_KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

function normalizeSettingValue(key: string, value: string): string {
	if (key === HABBO_GAMEDATA_HOTEL_SETTING_KEY) {
		return normalizeHabboGamedataHotel(value);
	}
	return value;
}

function bustGamedataCachesIfNeeded(key: string): void {
	if (key === HABBO_GAMEDATA_HOTEL_SETTING_KEY) {
		clearOfficialHabboFurnidataCache();
		clearBadgeCache();
	}
}

const saveManagedSchema = z.object({
	settings: z.record(z.string(), z.string()),
});

export const saveManagedSettings = adminAction(
	{
		permission: PERMS.SETTINGS_EDIT,
		schema: saveManagedSchema,
		rateLimitKey: "admin-settings-save",
		rateLimitMax: 30,
	},
	async (ctx) => {
		const entries = Object.entries(ctx.data.settings)
			.filter(([key]) => managedKeySet.has(key))
			.map(([key, value]) => [key, normalizeSettingValue(key, value)] as const);
		await Promise.all(
			entries.map(([key, value]) =>
				db
					.insert(WebsiteSetting)
					.values({ key, value })
					.onDuplicateKeyUpdate({ set: { value } }),
			),
		);
		await siteSettings.reload();
		if (entries.some(([key]) => key === HABBO_GAMEDATA_HOTEL_SETTING_KEY)) {
			clearOfficialHabboFurnidataCache();
			clearBadgeCache();
		}
		revalidatePath("/admin/settings");
		revalidatePath("/admin/catalog");
		return actionOk({ saved: entries.length });
	},
);

/** Lockout/security settings: only `saveManagedSettings` changes them, never the free-form forms. */
function isLockedRawKey(key: string): boolean {
	return (
		key === "force_staff_2fa" ||
		key === "min_staff_rank" ||
		key === "maintenance_enabled"
	);
}

export async function updateSetting(formData: FormData): Promise<void> {
	await requirePermissionRateLimited(PERMS.SETTINGS_EDIT);
	const key = String(formData.get("key") ?? "")
		.normalize("NFC")
		.trim();
	const raw = String(formData.get("value") ?? "").normalize("NFC");
	if (!key || !RAW_SETTING_KEY_RE.test(key) || isLockedRawKey(key)) return;
	// Blank on a secret means "keep what is stored", so the UI can render a
	// placeholder without the risk of wiping the credential.
	if (isSecretSettingKey(key) && raw === SECRET_PLACEHOLDER) return;
	const value = isSecretSettingKey(key) ? raw : normalizeSettingValue(key, raw);
	await db
		.insert(WebsiteSetting)
		.values({ key, value })
		.onDuplicateKeyUpdate({ set: { value } });
	await siteSettings.reload();
	bustGamedataCachesIfNeeded(key);
	revalidatePath("/admin/settings");
}

export async function createSetting(formData: FormData): Promise<void> {
	await requirePermissionRateLimited(PERMS.SETTINGS_EDIT);
	const key = String(formData.get("key") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 128);
	const value = normalizeSettingValue(
		key,
		String(formData.get("value") ?? "").normalize("NFC"),
	);
	const comment = String(formData.get("comment") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	// Managed keys go through `saveManagedSettings`; anything else must be a
	// clearly namespaced custom key, and lockout/security settings are never
	// writable through the free-form form.
	if (!key || !RAW_SETTING_KEY_RE.test(key) || isLockedRawKey(key)) return;
	await db
		.insert(WebsiteSetting)
		.values({ key, value, comment: comment || null })
		.onDuplicateKeyUpdate({ set: { value } });
	await siteSettings.reload();
	bustGamedataCachesIfNeeded(key);
	revalidatePath("/admin/settings");
}

export async function deleteSetting(formData: FormData): Promise<void> {
	await requirePermissionRateLimited(PERMS.SETTINGS_EDIT);
	const key = String(formData.get("key") ?? "")
		.normalize("NFC")
		.trim();
	// Deleting a lockout setting or a secret would switch that protection off (or drop the credential).
	if (!key || isLockedRawKey(key) || isSecretSettingKey(key)) return;
	await db.delete(WebsiteSetting).where(eq(WebsiteSetting.key, key));
	await siteSettings.reload();
	bustGamedataCachesIfNeeded(key);
	revalidatePath("/admin/settings");
}
