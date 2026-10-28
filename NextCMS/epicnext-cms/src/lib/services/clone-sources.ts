import { randomUUID } from "node:crypto";
import { siteSettings } from "@/lib/services/site-settings";

export interface CloneSource {
	id: string;
	name: string;
	furnidataUrl: string;
	nitroBaseUrl: string;
	iconBaseUrl: string;
	hotel: string;
	/**
	 * Optional per-source base URL for downloading SWF files.
	 * When set, the import service will try this URL before falling back
	 * to the official Habbo CDN (images.habbo.com).
	 *
	 * Retro hotels often have their own dcr/hof_furni structure,
	 * e.g. "https://virtualcity.nl/dcr" →
	 * "https://virtualcity.nl/dcr/hof_furni/{revision}/{classname}.swf"
	 */
	sourceSwfBaseUrl?: string;
	/**
	 * When false the source is excluded from the merged list (defaults to
	 * true). Used to retire sources whose assets can no longer be reached
	 * while keeping their definition in the site setting for later reuse.
	 */
	enabled?: boolean;
}

const KEY = "clone_sources";

/**
 * Verified sources. Used as the default list and as the fallback when the
 * `clone_sources` site setting is empty.
 *
 * Furnidata URLs verified HTTP 200 on 2026-08-06.
 * Retro sources using Cloudflare may require browser-like headers on fetch.
 */
export const DEFAULT_SOURCES: CloneSource[] = [
	{
		id: "default-habbo-com",
		name: "Habbo (COM)",
		furnidataUrl: "https://www.habbo.com/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com",
	},
	{
		id: "default-habbo-nl",
		name: "Habbo (NL)",
		furnidataUrl: "https://www.habbo.nl/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "nl",
	},
	{
		id: "default-habbo-de",
		name: "Habbo (DE)",
		furnidataUrl: "https://www.habbo.de/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "de",
	},
	{
		id: "default-habbo-fr",
		name: "Habbo (FR)",
		furnidataUrl: "https://www.habbo.fr/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "fr",
	},
	{
		id: "default-habbo-es",
		name: "Habbo (ES)",
		furnidataUrl: "https://www.habbo.es/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "es",
	},
	{
		id: "default-habbo-fi",
		name: "Habbo (FI)",
		furnidataUrl: "https://www.habbo.fi/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "fi",
	},
	{
		id: "default-habbo-br",
		name: "Habbo (BR)",
		furnidataUrl: "https://www.habbo.com.br/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com.br",
	},
	{
		id: "default-habbo-tr",
		name: "Habbo (TR)",
		furnidataUrl: "https://www.habbo.com.tr/gamedata/furnidata_json/1",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com.tr",
	},
	{
		id: "default-habbo-it",
		name: "Habbo (IT - GitHub mirror)",
		furnidataUrl:
			"https://raw.githubusercontent.com/Izzxt/habbo-resource/master/gamedata/furnidata.json",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "it",
	},
	{
		id: "default-yabbohotel",
		name: "YabboHotel",
		furnidataUrl: "https://yabbohotel.com/gamedata/FurnitureData.json",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com",
	},
	{
		id: "default-wibbo",
		name: "Wibbo",
		furnidataUrl: "https://assets.wibbo.org/gamedata/FurnitureData.json",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com",
	},
	{
		id: "default-hubba",
		name: "Hubba.cc",
		furnidataUrl: "https://nitro.hubba.cc/gamedata/FurnitureData.json",
		nitroBaseUrl: "",
		iconBaseUrl: "",
		hotel: "com",
	},
	{
		id: "default-habblet-city",
		name: "Habblet City",
		furnidataUrl: "https://www.habblet.city/gamedata/furnidata.json",
		nitroBaseUrl: "https://www.habblet.city/nitro/bundled/furniture",
		iconBaseUrl: "https://www.habblet.city/nitro/icons",
		hotel: "com",
		// Retro hotels may use their own SWF server (Habbo official CDN still has legacy files)
		// This field enables per-source SWF/nitro/icon download base URL fallback
		// The import service will try: sourceSwfBaseUrl > images.habbo.com
		sourceSwfBaseUrl: "https://www.habblet.city/dcr",
	},
	{
		id: "default-virtualcity",
		name: "VirtualCity",
		furnidataUrl: "https://virtualc.nl/gamedata/FurnitureData.json",
		nitroBaseUrl: "https://virtualc.nl/nitro/bundled/furniture",
		iconBaseUrl: "https://virtualc.nl/nitro/icons",
		hotel: "com",
		sourceSwfBaseUrl: "https://virtualc.nl/dcr",
	},
	{
		id: "default-sodastudios",
		name: "SodaStudios",
		furnidataUrl: "https://assets.sodaho.tel/gamedata/FurnitureData.json",
		nitroBaseUrl: "https://assets.sodaho.tel/bundled/furniture",
		iconBaseUrl: "https://assets.sodaho.tel/dcr/hof_furni/icons",
		hotel: "com",
	},
	{
		id: "default-habboon",
		name: "Habboon",
		furnidataUrl: "https://assets.habboon.pw/nitro/gamedata/FurnitureData.json",
		nitroBaseUrl: "https://assets.habboon.pw/nitro/bundled/furniture",
		iconBaseUrl: "",
		hotel: "com",
		// Habboon serves SWFs at /dcr/hof_furni/{classname}.swf (no revision
		// segment) — the import service also tries that variant.
		sourceSwfBaseUrl: "https://assets.habboon.pw/dcr",
	},
	{
		id: "default-leet",
		name: "Leet",
		furnidataUrl:
			"https://images.leet.city/leet-asset-bundles/gamedata/leet_furni.json?v=7ce4b1ce",
		nitroBaseUrl:
			"https://images.leet.city/leet-asset-bundles/libraries/furniture_new2",
		iconBaseUrl: "https://images.leet.city/library/hof_furni/icons",
		hotel: "com",
		// Leet serves SWFs at /library/hof_furni/{classname}.swf (no revision
		// segment) — the import service tries both with- and without-revision.
		sourceSwfBaseUrl: "https://images.leet.city/library",
	},
	{
		id: "default-hubbly",
		name: "Hubbly",
		furnidataUrl: "https://hubbly.pw/nitro/gamedata/hubbly_furni.json",
		nitroBaseUrl: "https://hubbly.pw/nitro/furniture",
		iconBaseUrl: "https://hubbly.pw/swf/dcr/hof_furni/icons",
		hotel: "com",
		// Hubbly serves no standalone SWFs — the .nitro bundles are used.
	},
];

export const DEFAULT_ICON_SOURCES: CloneSource[] = DEFAULT_SOURCES.filter(
	(s) => s.iconBaseUrl,
);

export const DEFAULT_NITRO_SOURCES: CloneSource[] = DEFAULT_SOURCES.filter(
	(s) => s.nitroBaseUrl,
);

export async function listSources(): Promise<CloneSource[]> {
	const raw = (await siteSettings.get(KEY, "[]")) ?? "[]";
	let stored: CloneSource[] = [];
	try {
		const arr = JSON.parse(raw);
		if (Array.isArray(arr)) stored = arr;
	} catch {
		// fall through to defaults-only
	}
	// Merge the verified default presets with any user-added/edited sources so
	// the admin always has many sources to pick from. User entries win on id.
	const merged = new Map<string, CloneSource>();
	for (const src of DEFAULT_SOURCES) merged.set(src.id, src);
	for (const src of stored) {
		if (src.id && src.furnidataUrl) merged.set(src.id, src);
	}
	return Array.from(merged.values()).filter((s) => s.enabled !== false);
}

export async function upsertSource(
	src: Omit<CloneSource, "id"> & { id?: string },
): Promise<CloneSource> {
	const sources = await listSources();
	const swfBase = src.sourceSwfBaseUrl?.trim().replace(/\/+$/, "");
	const entry: CloneSource = {
		id: src.id || randomUUID(),
		name: src.name.trim(),
		furnidataUrl: src.furnidataUrl.trim(),
		nitroBaseUrl: src.nitroBaseUrl.trim().replace(/\/+$/, ""),
		iconBaseUrl: src.iconBaseUrl.trim().replace(/\/+$/, ""),
		hotel: (src.hotel ?? "").trim(),
		sourceSwfBaseUrl: swfBase || undefined,
		enabled: src.enabled ?? true,
	};
	const idx = sources.findIndex((s) => s.id === entry.id);
	if (idx >= 0) sources[idx] = entry;
	else sources.push(entry);
	await siteSettings.update(KEY, JSON.stringify(sources));
	return entry;
}

export async function deleteSource(id: string): Promise<void> {
	const sources = (await listSources()).filter((s) => s.id !== id);
	await siteSettings.update(KEY, JSON.stringify(sources));
}

export async function getSource(id: string): Promise<CloneSource | null> {
	return (await listSources()).find((s) => s.id === id) ?? null;
}
