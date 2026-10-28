"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { MEDIA_ROOT, resolveMediaPath } from "@/lib/media-storage";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { logStaffActivity } from "@/lib/services/staff-activity";
import {
	BACKGROUND_DEFAULTS,
	BACKGROUND_EFFECTS,
	BACKGROUND_POSITIONS,
	BACKGROUND_REPEATS,
	BACKGROUND_SIZES,
	isSafeBackgroundUrl,
	OVERLAY_OPACITY_MAX,
} from "@/lib/theme-bg";
import {
	type CustomTheme,
	deleteCustomThemeStore,
	getCustomTheme,
	listCustomThemes,
	snapshotCurrentTheme,
	upsertCustomTheme,
} from "@/lib/theme-custom-store";
import { normalizeImportedTheme } from "@/lib/theme-manager-format";
import { PRESETS } from "@/lib/theme-presets";
import { presetSettings } from "@/lib/theme-settings";

const MANAGER_PATH = "/admin-next/hotel/theme-manager";
const IMPORT_MAX_BYTES = 256 * 1024; // 256KB
const BACKGROUND_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const BACKGROUND_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

async function writeSetting(key: string, value: string): Promise<void> {
	await db
		.insert(WebsiteSetting)
		.values({ key, value, comment: "Theme (housekeeping)" })
		.onDuplicateKeyUpdate({ set: { value } });
}

async function applySettings(
	settings: Record<string, string>,
	appliedName: string,
): Promise<void> {
	for (const [key, value] of Object.entries(settings)) {
		if (value !== "") await writeSetting(key, value);
	}
	await writeSetting("theme_preset", appliedName);
	siteSettings.reload();
	revalidatePath("/", "layout");
}

export async function saveCurrentTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 100);
	if (name) {
		const snapshot = await snapshotCurrentTheme();
		try {
			const theme = await upsertCustomTheme(name, snapshot);
			await logStaffActivity({
				staffId: staff.id,
				action: "theme_preset",
				description: `Saved custom theme "${theme.name}"`,
			});
			revalidatePath(MANAGER_PATH);
		} catch {
			// ignore — page re-renders current state
		}
	}
	redirect(`${MANAGER_PATH}?notice=saved`);
}

export async function applyTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	const theme = id ? await getCustomTheme(id) : null;
	if (!theme) redirect(MANAGER_PATH);
	try {
		await applySettings(theme.settings, theme.name);
		revalidatePath(MANAGER_PATH);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_preset",
			description: `Applied custom theme "${theme.name}"`,
		});
	} catch {
		// ignore — page re-renders current state
	}
	redirect(`${MANAGER_PATH}?notice=applied`);
}

export async function renameTheme(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 100);
	if (id && name) {
		try {
			const snapshot = await snapshotCurrentTheme();
			await upsertCustomTheme(name, snapshot, id);
			revalidatePath(MANAGER_PATH);
		} catch {
			// ignore
		}
	}
	redirect(`${MANAGER_PATH}?notice=renamed`);
}

export async function deleteTheme(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const id = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	try {
		await deleteCustomThemeStore(id);
		revalidatePath(MANAGER_PATH);
	} catch {
		// ignore
	}
	redirect(`${MANAGER_PATH}?notice=deleted`);
}

export async function importTheme(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const file = formData.get("file") as File | null;
	const fallbackName = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 100);
	const applyNow = formData.get("apply") === "1";

	let imported: CustomTheme | null = null;
	try {
		if (file && file.size > 0 && file.size <= IMPORT_MAX_BYTES) {
			const raw = await file.text();
			if (raw.length <= IMPORT_MAX_BYTES) {
				const payload = JSON.parse(raw) as unknown;
				const normalized = normalizeImportedTheme(payload, fallbackName);
				if (normalized) {
					const theme = await upsertCustomTheme(
						normalized.name,
						normalized.settings,
					);
					if (applyNow) {
						await applySettings(theme.settings, theme.name);
					}
					await logStaffActivity({
						staffId: staff.id,
						action: "theme_preset",
						description: `Imported theme "${theme.name}"`,
					});
					revalidatePath(MANAGER_PATH);
					imported = theme;
				}
			}
		}
	} catch {
		// ignore — the error notice is shown below
	}
	if (imported) redirect(`${MANAGER_PATH}?notice=imported`);
	redirect(`${MANAGER_PATH}?notice=importError`);
}

export async function saveBackground(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const image = String(formData.get("background_image") ?? "")
		.normalize("NFC")
		.trim();
	const position = String(formData.get("background_position") ?? "")
		.normalize("NFC")
		.trim();
	const size = String(formData.get("background_size") ?? "")
		.normalize("NFC")
		.trim();
	const repeat = String(formData.get("background_repeat") ?? "")
		.normalize("NFC")
		.trim();
	const effect = String(formData.get("background_effect") ?? "")
		.normalize("NFC")
		.trim();
	const overlay = String(formData.get("background_overlay") ?? "")
		.normalize("NFC")
		.trim();
	const overlayOpacity = String(
		formData.get("background_overlay_opacity") ?? "",
	)
		.normalize("NFC")
		.trim();

	if (image && !isSafeBackgroundUrl(image)) redirect(MANAGER_PATH);

	try {
		await writeSetting("background_image", image);
		await writeSetting(
			"background_position",
			(BACKGROUND_POSITIONS as readonly string[]).includes(position)
				? position
				: BACKGROUND_DEFAULTS.background_position,
		);
		await writeSetting(
			"background_size",
			(BACKGROUND_SIZES as readonly string[]).includes(size)
				? size
				: BACKGROUND_DEFAULTS.background_size,
		);
		await writeSetting(
			"background_repeat",
			(BACKGROUND_REPEATS as readonly string[]).includes(repeat)
				? repeat
				: BACKGROUND_DEFAULTS.background_repeat,
		);
		await writeSetting(
			"background_effect",
			(BACKGROUND_EFFECTS as readonly string[]).includes(effect)
				? effect
				: BACKGROUND_DEFAULTS.background_effect,
		);
		await writeSetting(
			"background_overlay",
			/^#[0-9a-fA-F]{3,8}$/.test(overlay) ? overlay : "",
		);
		await writeSetting(
			"background_overlay_opacity",
			/^\d{1,2}$/.test(overlayOpacity)
				? String(Math.min(parseInt(overlayOpacity, 10), OVERLAY_OPACITY_MAX))
				: "0",
		);
		siteSettings.reload();
		revalidatePath("/", "layout");
		revalidatePath(MANAGER_PATH);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_update",
			description: "Updated site background",
		});
	} catch {
		// ignore
	}
	redirect(`${MANAGER_PATH}?notice=background`);
}

export async function clearBackground(): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	try {
		for (const key of Object.keys(BACKGROUND_DEFAULTS)) {
			await writeSetting(key, "");
		}
		siteSettings.reload();
		revalidatePath("/", "layout");
		revalidatePath(MANAGER_PATH);
	} catch {
		// ignore
	}
	redirect(`${MANAGER_PATH}?notice=background`);
}

export async function uploadBackground(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const file = formData.get("file") as File | null;
	if (!file || file.size === 0 || file.size > BACKGROUND_MAX_BYTES)
		redirect(`${MANAGER_PATH}?notice=backgroundError`);
	if (!BACKGROUND_MIME.includes(file.type))
		redirect(`${MANAGER_PATH}?notice=backgroundError`);

	let uploaded = false;
	try {
		await mkdir(MEDIA_ROOT, { recursive: true });
		const ext = file.name.split(".").pop() ?? "png";
		const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
		const bytes = await file.arrayBuffer();
		const filePath = resolveMediaPath(name);
		if (filePath.startsWith(MEDIA_ROOT + path.sep)) {
			await writeFile(filePath, Buffer.from(bytes));
			await writeSetting("background_image", `/api/media/${name}`);
			await writeSetting(
				"background_position",
				BACKGROUND_DEFAULTS.background_position,
			);
			await writeSetting(
				"background_size",
				BACKGROUND_DEFAULTS.background_size,
			);
			await writeSetting(
				"background_repeat",
				BACKGROUND_DEFAULTS.background_repeat,
			);
			siteSettings.reload();
			revalidatePath("/", "layout");
			revalidatePath(MANAGER_PATH);
			revalidatePath("/api/media");
			uploaded = true;
		}
	} catch {
		// ignore — the error notice is shown below
	}
	redirect(
		`${MANAGER_PATH}?notice=${uploaded ? "background" : "backgroundError"}`,
	);
}

export async function applyPresetManager(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);
	const name = String(formData.get("preset") ?? "")
		.normalize("NFC")
		.trim();
	// guarded by null check below
	const preset = PRESETS[name];
	if (!preset) redirect(MANAGER_PATH);

	try {
		for (const [key, value] of presetSettings(preset))
			await writeSetting(key, value);
		await writeSetting("theme_preset", name);
		siteSettings.reload();
		revalidatePath("/", "layout");
		revalidatePath(MANAGER_PATH);
		await logStaffActivity({
			staffId: staff.id,
			action: "theme_preset",
			description: `Applied theme preset "${name}"`,
		});
	} catch {
		// ignore
	}
	redirect(`${MANAGER_PATH}?notice=preset`);
}

/** Read-only data for the Theme Manager page (server side). */
export async function getThemeManagerData() {
	await requirePermission(PERMS.SETTINGS_VIEW);
	const [themes, current, backgroundValues] = await Promise.all([
		listCustomThemes(),
		snapshotCurrentTheme(),
		siteSettings.getMany(Object.keys(BACKGROUND_DEFAULTS)),
	]);
	return {
		themes,
		current,
		background: {
			image:
				backgroundValues.background_image &&
				isSafeBackgroundUrl(backgroundValues.background_image)
					? backgroundValues.background_image
					: "",
			position: (BACKGROUND_POSITIONS as readonly string[]).includes(
				backgroundValues.background_position ?? "",
			)
				? (backgroundValues.background_position as string)
				: BACKGROUND_DEFAULTS.background_position,
			size: (BACKGROUND_SIZES as readonly string[]).includes(
				backgroundValues.background_size ?? "",
			)
				? (backgroundValues.background_size as string)
				: BACKGROUND_DEFAULTS.background_size,
			repeat: (BACKGROUND_REPEATS as readonly string[]).includes(
				backgroundValues.background_repeat ?? "",
			)
				? (backgroundValues.background_repeat as string)
				: BACKGROUND_DEFAULTS.background_repeat,
			effect: (BACKGROUND_EFFECTS as readonly string[]).includes(
				backgroundValues.background_effect ?? "",
			)
				? (backgroundValues.background_effect as string)
				: BACKGROUND_DEFAULTS.background_effect,
			overlay: /^#[0-9a-fA-F]{3,8}$/.test(
				backgroundValues.background_overlay ?? "",
			)
				? (backgroundValues.background_overlay as string)
				: "",
			overlayOpacity: /^\d{1,2}$/.test(
				backgroundValues.background_overlay_opacity ?? "",
			)
				? String(
						Math.min(
							parseInt(
								backgroundValues.background_overlay_opacity as string,
								10,
							),
							OVERLAY_OPACITY_MAX,
						),
					)
				: "0",
		},
	};
}
