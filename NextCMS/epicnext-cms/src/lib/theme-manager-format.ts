import { BACKGROUND_KEYS } from "@/lib/theme-bg";
import { THEME_COLOR_KEYS } from "@/lib/theme-presets";

// Shared by the Theme Manager import/export flow. Pure helpers, kept module-
// free so they can be unit-tested without a server.

export const THEME_IMPORT_FORMAT = "atom-theme-v1" as const;

export const SWATCH_KEYS = [
	"color_primary",
	"color_accent",
	"color_surface",
	"color_text",
] as const;

// Non-color settings that may be carried inside an exported theme alongside
// the color palette. Mirrors the EXTRA_KEYS list in theme-custom-store.
export const EXTRA_SYSTEM_KEYS = [
	"admin_canvas",
	"admin_surface",
	"admin_text",
	"admin_text_muted",
	"admin_border",
	"admin_sidebar_bg",
	"border_radius",
	"font_family",
	"size_heading_h1",
	"size_heading_h2",
	"size_heading_h3",
	"custom_css",
	"theme_preset",
	...BACKGROUND_KEYS,
] as const;

const COLOR_KEYS = new Set<string>([
	...THEME_COLOR_KEYS,
	...THEME_COLOR_KEYS.map((k) => `${k}_dark`),
]);

export const THEME_ALLOWED_SETTING_KEYS = new Set<string>([
	...COLOR_KEYS,
	...EXTRA_SYSTEM_KEYS,
]);

const COLOR_RE = /^[#a-zA-Z0-9(),.\s%-]+$/;
const MAX_VALUE_LENGTH = 20000;
const MAX_CUSTOM_CSS_LENGTH = 20000;

function squareJs(value: string): boolean {
	return /^[\x20-\x7E]+$/.test(value);
}

function cleanSettingValue(key: string, value: unknown): string | null {
	if (typeof value !== "string") {
		if (typeof value === "number" && Number.isFinite(value))
			return String(value);
		return null;
	}
	const normalized = value.normalize("NFC").trim();
	if (normalized.length === 0) return "";
	if (normalized.length > MAX_VALUE_LENGTH) return null;
	if (!squareJs(normalized)) return null;
	if (key === "custom_css" && normalized.length > MAX_CUSTOM_CSS_LENGTH)
		return null;
	// Color settings feed CSS custom properties — keep them colour-safe.
	if (COLOR_KEYS.has(key) && !COLOR_RE.test(normalized)) return null;
	return normalized;
}

export interface NormalizedImportedTheme {
	name: string;
	settings: Record<string, string>;
}

/**
 * Accepts both the native theme-manager export (`{ format, name, settings }`)
 * and the `/cms_api/themes/export` shape (`{ palette: { light, dark }, meta }`).
 * Returns null when the payload is unrecognised.
 */
export function normalizeImportedTheme(
	payload: unknown,
	fallbackName?: string,
): NormalizedImportedTheme | null {
	if (!payload || typeof payload !== "object") return null;
	const record = payload as Record<string, unknown>;

	if (record.format === THEME_IMPORT_FORMAT && record.settings) {
		if (
			typeof record.settings !== "object" ||
			record.settings === null ||
			Array.isArray(record.settings)
		)
			return null;
		const name =
			typeof record.name === "string" && record.name.trim()
				? record.name.trim().slice(0, 100)
				: (fallbackName ?? "Imported theme");
		return {
			name,
			settings: sanitizeSettings(record.settings as Record<string, unknown>),
		};
	}

	if (
		record.meta &&
		(record.meta as Record<string, unknown>).format === THEME_IMPORT_FORMAT
	) {
		const palette = record.palette as
			| { light?: Record<string, unknown>; dark?: Record<string, unknown> }
			| undefined;
		if (!palette || typeof palette !== "object") return null;
		const settings: Record<string, string> = {};
		for (const key of THEME_COLOR_KEYS) {
			const light = palette.light?.[key];
			if (light != null) {
				const cleaned = cleanSettingValue(key, light);
				if (cleaned !== null && cleaned) settings[key] = cleaned;
			}
			const dark = palette.dark?.[key];
			if (dark != null) {
				const cleaned = cleanSettingValue(`${key}_dark`, dark);
				if (cleaned !== null && cleaned) settings[`${key}_dark`] = cleaned;
			}
		}
		const name =
			typeof record.name === "string" && record.name.trim()
				? record.name.trim().slice(0, 100)
				: (fallbackName ?? "Imported theme");
		return { name, settings };
	}

	return null;
}

function sanitizeSettings(
	settings: Record<string, unknown>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(settings)) {
		if (!THEME_ALLOWED_SETTING_KEYS.has(key)) continue;
		const cleaned = cleanSettingValue(key, value);
		if (cleaned === null) continue;
		result[key] = cleaned;
	}
	return result;
}

/**
 * Serialises a theme for export in the native theme-manager format.
 */
export function serializeThemeExport(
	name: string,
	settings: Record<string, string>,
): string {
	return JSON.stringify(
		{
			format: THEME_IMPORT_FORMAT,
			name,
			exportedAt: new Date().toISOString(),
			settings,
		},
		null,
		2,
	);
}

export function swatchColors(settings: Record<string, string>): string[] {
	return SWATCH_KEYS.map((key) => settings[key] ?? "#64748b");
}
