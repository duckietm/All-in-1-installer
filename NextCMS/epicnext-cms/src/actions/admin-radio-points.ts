"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { logStaffActivity } from "@/lib/services/staff-activity";

// Radio listener-points settings (website_settings radio_points_* keys).
// Mirrors AtomCMS's RadioPoints Filament page: key/value rows in
// website_settings that reward listeners for time spent on the radio. Booleans
// use the string '0' / '1'. Busts the siteSettings cache so the public radio
// pages pick the change up immediately.

const POINTS_KEYS = [
	"radio_points_enabled",
	"radio_points_per_minute",
	"radio_points_currency",
	"radio_points_max_per_day",
	"radio_points_min_listeners",
] as const;

const ALLOWED_CURRENCIES = new Set([
	"credits",
	"duckets",
	"diamonds",
	"points",
]);

function str(raw: FormDataEntryValue | null): string {
	return typeof raw === "string" ? raw : "";
}

/** Checkbox/select truthiness → '1' / '0'. */
function boolStr(raw: FormDataEntryValue | null): "0" | "1" {
	const v = str(raw).trim().toLowerCase();
	return v === "1" || v === "true" || v === "on" ? "1" : "0";
}

/** Clamp a form value to a non-negative integer string (defaulting to 0). */
function intStr(raw: FormDataEntryValue | null): string {
	const n = Number(str(raw).trim());
	if (!Number.isFinite(n) || n < 0) return "0";
	return String(Math.floor(n));
}

export async function savePoints(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);

	const currencyRaw = str(formData.get("radio_points_currency"))
		.trim()
		.toLowerCase();
	const currency = ALLOWED_CURRENCIES.has(currencyRaw)
		? currencyRaw
		: "credits";

	const values: Record<(typeof POINTS_KEYS)[number], string> = {
		radio_points_enabled: boolStr(formData.get("radio_points_enabled")),
		radio_points_per_minute: intStr(formData.get("radio_points_per_minute")),
		radio_points_currency: currency,
		radio_points_max_per_day: intStr(formData.get("radio_points_max_per_day")),
		radio_points_min_listeners: intStr(
			formData.get("radio_points_min_listeners"),
		),
	};

	try {
		await Promise.all(
			POINTS_KEYS.map((key) =>
				db
					.insert(WebsiteSetting)
					// key from POINTS_KEYS const
					.values({ key, value: values[key], comment: "Radio points" })
					.onDuplicateKeyUpdate({
						// key from POINTS_KEYS const
						set: { value: values[key] },
					}),
			),
		);
		siteSettings.reload();
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_points_update",
			description: `Updated radio listener-points settings (enabled=${values.radio_points_enabled}, ${values.radio_points_per_minute}/min ${currency})`,
		});
	} catch {
		// DB unavailable — fail soft so the action does not throw.
	}

	revalidatePath("/admin/radio/points");
	redirect("/admin/radio/points?saved=1");
}
