/**
 * Client-safe Habbo gamedata hotel helpers (no Node/DB imports).
 * Server-only reader: `@/lib/services/habbo-gamedata-hotel`.
 */

/** Official Habbo hotel TLDs used for gamedata (furnidata / external texts). */
export const HABBO_GAMEDATA_HOTELS = [
	{ value: "it", label: "Italy (habbo.it)" },
	{ value: "com", label: "International (habbo.com)" },
	{ value: "es", label: "Spain (habbo.es)" },
	{ value: "de", label: "Germany (habbo.de)" },
	{ value: "fr", label: "France (habbo.fr)" },
	{ value: "fi", label: "Finland (habbo.fi)" },
	{ value: "nl", label: "Netherlands (habbo.nl)" },
	{ value: "com.br", label: "Brazil (habbo.com.br)" },
	{ value: "com.tr", label: "Turkey (habbo.com.tr)" },
] as const;

export type HabboGamedataHotel =
	(typeof HABBO_GAMEDATA_HOTELS)[number]["value"];

export interface FurniImportSource {
	hotel: HabboGamedataHotel;
	label: string;
	host: string;
	furnidataUrl: string;
	assetCdnHost: "images.habbo.com";
}

export const HABBO_GAMEDATA_HOTEL_SETTING_KEY = "habbo_gamedata_hotel";
export const DEFAULT_HABBO_GAMEDATA_HOTEL: HabboGamedataHotel = "it";

const ALLOWED = new Set<string>(HABBO_GAMEDATA_HOTELS.map((h) => h.value));

export function normalizeHabboGamedataHotel(
	raw: string | null | undefined,
): HabboGamedataHotel {
	const v = (raw ?? "").trim().toLowerCase();
	if (ALLOWED.has(v)) return v as HabboGamedataHotel;
	return DEFAULT_HABBO_GAMEDATA_HOTEL;
}

export function habboGamedataHotelLabel(hotel: string): string {
	const found = HABBO_GAMEDATA_HOTELS.find((h) => h.value === hotel);
	return found?.label ?? `habbo.${hotel}`;
}

/** Short badge for buttons, e.g. IT / COM / COM.BR */
export function habboGamedataHotelShort(hotel: string): string {
	return normalizeHabboGamedataHotel(hotel).toUpperCase();
}

export function habboFurnidataUrl(hotel: string): string {
	const h = normalizeHabboGamedataHotel(hotel);
	return `https://www.habbo.${h}/gamedata/furnidata_json/1`;
}

export function buildFurniImportSource(hotel: string): FurniImportSource {
	const normalized = normalizeHabboGamedataHotel(hotel);
	return {
		hotel: normalized,
		label: habboGamedataHotelLabel(normalized),
		host: `habbo.${normalized}`,
		furnidataUrl: habboFurnidataUrl(normalized),
		assetCdnHost: "images.habbo.com",
	};
}

export function officialHabboEnrichmentWarning(
	hotel: string,
	name: string,
): string {
	const normalized = normalizeHabboGamedataHotel(hotel);
	return `Enriched from habbo.${normalized}: "${name}"`;
}

export function habboExternalTextsUrl(hotel: string): string {
	const h = normalizeHabboGamedataHotel(hotel);
	return `https://www.habbo.${h}/gamedata/external_flash_texts/1`;
}
