"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { ensureReadableThemeColors } from "@/lib/theme-contrast";
import {
	deleteCustomThemeStore,
	getCustomTheme,
	snapshotCurrentTheme,
	upsertCustomTheme,
} from "@/lib/theme-custom-store";
import { FONTS, PRESETS, THEME_COLOR_KEYS } from "@/lib/theme-presets";
import { presetSettings, settingKey } from "@/lib/theme-settings";

// Only hex/keyword colour values are accepted (matches ThemeVars' sanitiser).
const COLOR_RE = /^[#a-zA-Z0-9(),.\s%-]+$/;
// Extra colour settings beyond the preset palette (buttons + links + gradients).
const HEADING_KEYS = ["size_heading_h1", "size_heading_h2", "size_heading_h3"];
const CUSTOM_CSS_MAX = 20000;

async function writeSetting(key: string, value: string): Promise<void> {
	await db
		.insert(WebsiteSetting)
		.values({ key, value, comment: "Theme (housekeeping)" })
		.onDuplicateKeyUpdate({ set: { value } });
}

export async function saveTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);

	try {
		for (const mode of ["light", "dark"] as const) {
			const bag: Record<string, string> = {};
			for (const key of THEME_COLOR_KEYS) {
				const dbKey = settingKey(key, mode);
				const raw = String(formData.get(dbKey) ?? "")
					.normalize("NFC")
					.trim();
				if (raw && COLOR_RE.test(raw)) bag[key] = raw;
			}
			const fixed = ensureReadableThemeColors(bag);
			for (const [key, value] of Object.entries(fixed)) {
				await writeSetting(
					settingKey(key as (typeof THEME_COLOR_KEYS)[number], mode),
					value,
				);
			}
		}
		const ADMIN_KEYS = [
			"admin_canvas",
			"admin_surface",
			"admin_text",
			"admin_text_muted",
			"admin_border",
			"admin_sidebar_bg",
		] as const;
		const adminBag: Record<string, string> = {};
		for (const key of ADMIN_KEYS) {
			const raw = String(formData.get(key) ?? "")
				.normalize("NFC")
				.trim();
			if (raw && COLOR_RE.test(raw)) adminBag[key] = raw;
		}
		const adminFixed = ensureReadableThemeColors(adminBag);
		for (const [key, value] of Object.entries(adminFixed)) {
			await writeSetting(key, value);
		}

		const radius = String(formData.get("border_radius") ?? "")
			.normalize("NFC")
			.trim();
		if (/^\d{1,3}$/.test(radius)) await writeSetting("border_radius", radius);

		// Typography
		const font = String(formData.get("font_family") ?? "")
			.normalize("NFC")
			.trim();
		if (font in FONTS) await writeSetting("font_family", font);
		for (const key of HEADING_KEYS) {
			const v = String(formData.get(key) ?? "")
				.normalize("NFC")
				.trim();
			if (/^\d{1,3}$/.test(v)) await writeSetting(key, v);
		}

		// Raw custom CSS (staff-trusted; length-capped, ThemeVars injects it as-is).
		if (formData.has("custom_css")) {
			const cssRaw = String(formData.get("custom_css") ?? "")
				.normalize("NFC")
				.slice(0, CUSTOM_CSS_MAX);
			await writeSetting("custom_css", cssRaw);
		}

		siteSettings.reload();
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_update",
			description: "Updated theme settings",
		});
		revalidatePath("/", "layout");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect("/admin/theme?saved=1");
}

export async function applyPreset(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const name = String(formData.get("preset") ?? "").normalize("NFC");
	// guarded by null check below
	const preset = PRESETS[name];
	if (!preset) redirect("/admin/theme");

	try {
		for (const [key, value] of presetSettings(preset))
			await writeSetting(key, value);
		await writeSetting("theme_preset", name);
		siteSettings.reload();
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_preset",
			description: `Applied theme preset "${name}"`,
		});
		revalidatePath("/", "layout");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect(`/admin/theme?preset=${encodeURIComponent(name)}`);
}

export async function saveCustomTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim();
	if (!name) redirect("/admin/theme");
	const snapshot = await snapshotCurrentTheme();
	try {
		await upsertCustomTheme(name, snapshot);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_preset",
			description: `Saved custom theme "${name}"`,
		});
		revalidatePath("/admin/theme");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect("/admin/theme?savedTheme=1");
}

export async function applyCustomTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!id) redirect("/admin/theme");
	const theme = await getCustomTheme(id);
	if (!theme) redirect("/admin/theme");
	try {
		for (const [key, value] of Object.entries(theme.settings)) {
			if (value) await writeSetting(key, value);
		}
		await writeSetting("theme_preset", theme.name);
		siteSettings.reload();
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_preset",
			description: `Applied custom theme "${theme.name}"`,
		});
		revalidatePath("/", "layout");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect(`/admin/theme?theme=${encodeURIComponent(theme.name)}`);
}

export async function renameCustomTheme(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim();
	if (!id || !name) redirect("/admin/theme");
	const snapshot = await snapshotCurrentTheme();
	try {
		await upsertCustomTheme(name, snapshot, id);
		revalidatePath("/admin/theme");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect("/admin/theme?renamed=1");
}

export async function deleteCustomTheme(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!id) redirect("/admin/theme");
	try {
		await deleteCustomThemeStore(id);
		revalidatePath("/admin/theme");
	} catch {
		return redirect("/admin/theme?error=1");
	}
	redirect("/admin/theme?deletedTheme=1");
}
