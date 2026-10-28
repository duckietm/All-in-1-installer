import { db, WebsiteSetting } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";
import { BACKGROUND_DEFAULTS, BACKGROUND_KEYS } from "@/lib/theme-bg";
import {
	PRESETS,
	THEME_COLOR_KEYS,
	type ThemeColorKey,
} from "@/lib/theme-presets";

export interface CustomTheme {
	id: string;
	name: string;
	createdAt: number;
	settings: Record<string, string>;
}

const STORE_KEY = "custom_themes";

const EXTRA_KEYS = [
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
];

const ALL_KEYS: string[] = [
	...THEME_COLOR_KEYS.flatMap((k) => [k, `${k}_dark`]),
	...EXTRA_KEYS,
];

function fallbackFor(key: string): string {
	const preset = PRESETS["Atom (golden)"];
	if (key.endsWith("_dark")) {
		const base = key.slice(0, -"_dark".length) as ThemeColorKey;
		return preset.dark[base] ?? ""; // key derived from internal THEME_COLOR_KEYS
	}
	if (key in preset.light) {
		return preset.light[key as ThemeColorKey] ?? "";
	}
	const extras: Record<string, string> = {
		admin_canvas: "#0f172a",
		admin_surface: "#1e293b",
		admin_text: "#f1f5f9",
		admin_text_muted: "#94a3b8",
		admin_border: "#334155",
		admin_sidebar_bg: "#0f172a",
		border_radius: "12",
		font_family: "nunito",
		size_heading_h1: "30",
		size_heading_h2: "22",
		size_heading_h3: "18",
		custom_css: "",
		theme_preset: "Atom (golden)",
		...BACKGROUND_DEFAULTS,
	};
	return extras[key] ?? ""; // key derived from internal EXTRA_KEYS
}

export async function listCustomThemes(): Promise<CustomTheme[]> {
	const raw = await siteSettings.get(STORE_KEY, "[]");
	try {
		const parsed = JSON.parse(raw ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed as CustomTheme[];
	} catch {
		return [];
	}
}

export async function snapshotCurrentTheme(): Promise<Record<string, string>> {
	const entries = await Promise.all(
		ALL_KEYS.map(
			async (key) =>
				[key, (await siteSettings.get(key, null)) ?? fallbackFor(key)] as const,
		),
	);
	return Object.fromEntries(entries);
}

async function persist(themes: CustomTheme[]): Promise<void> {
	const value = JSON.stringify(themes);
	await db
		.insert(WebsiteSetting)
		.values({ key: STORE_KEY, value, comment: "Theme (housekeeping)" })
		.onDuplicateKeyUpdate({ set: { value } });
	siteSettings.reload();
}

export async function upsertCustomTheme(
	name: string,
	settings: Record<string, string>,
	id?: string,
): Promise<CustomTheme> {
	const themes = await listCustomThemes();
	const trimmed = name.trim() || "Untitled theme";
	if (id) {
		const idx = themes.findIndex((t) => t.id === id);
		if (idx >= 0) {
			themes[idx] = { ...themes[idx], name: trimmed, settings }; // idx from findIndex over internal array
			await persist(themes);
			return themes[idx]; // idx from findIndex over internal array
		}
	}
	const theme: CustomTheme = {
		id: globalThis.crypto.randomUUID(),
		name: trimmed,
		createdAt: Date.now(),
		settings,
	};
	themes.push(theme);
	await persist(themes);
	return theme;
}

export async function getCustomTheme(id: string): Promise<CustomTheme | null> {
	const themes = await listCustomThemes();
	return themes.find((t) => t.id === id) ?? null;
}

export async function deleteCustomThemeStore(id: string): Promise<void> {
	const themes = await listCustomThemes();
	await persist(themes.filter((t) => t.id !== id));
}
