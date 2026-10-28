"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

// Maintenance mode lives in three CMS-owned website_settings rows (mirrors
// AtomCMS's MaintenanceToggle Livewire component):
//   maintenance_enabled        '1' | '0'
//   maintenance_message        free text (HTML allowed, shown on the splash)
//   min_maintenance_login_rank int as string (min rank that may still log in)
// The Laravel login flow reads these via setting() to gate non-staff logins
// while maintenance is on, so the website_settings keys are the source of truth.

const KEY_ENABLED = "maintenance_enabled";
const KEY_MESSAGE = "maintenance_message";
const KEY_MIN_RANK = "min_maintenance_login_rank";

const COMMENTS: Record<string, string> = {
	[KEY_ENABLED]: "Determines whether maintenance is enabled or not",
	[KEY_MESSAGE]:
		"The maintenance message displayed to users while maintenance is activated",
	[KEY_MIN_RANK]:
		"The minimum rank required to login to the hotel during maintenance",
};

async function upsertSetting(key: string, value: string): Promise<void> {
	await db
		.insert(WebsiteSetting)
		.values({
			key,
			value,
			// key is one of 3 known const values
			comment: COMMENTS[key] ?? null,
		})
		.onDuplicateKeyUpdate({ set: { value } });
}

export async function saveMaintenance(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);

	// Checkbox: present only when ticked. Normalise to the '1'/'0' string the
	// emulator/Laravel side expects.
	const enabled = formData.get("enabled") != null ? "1" : "0";

	const message = String(formData.get("message") ?? "").normalize("NFC");

	// Coerce the rank to a non-negative integer; fall back to AtomCMS's default
	// of 5 when the field is blank or garbage.
	const rawRank = String(formData.get("min_rank") ?? "")
		.normalize("NFC")
		.trim();
	const parsedRank = Number.parseInt(rawRank, 10);
	const minRank =
		Number.isFinite(parsedRank) && parsedRank >= 0 ? parsedRank : 5;

	await upsertSetting(KEY_ENABLED, enabled);
	await upsertSetting(KEY_MESSAGE, message);
	await upsertSetting(KEY_MIN_RANK, String(minRank));

	siteSettings.reload();
	revalidatePath("/admin/maintenance");
}
