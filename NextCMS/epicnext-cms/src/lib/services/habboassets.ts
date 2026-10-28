/**
 * Badge search — powered by official Habbo external texts.
 *
 * Hotel locale comes from CMS setting `habbo_gamedata_hotel`.
 * Badge images from images.habbo.com/c_images/album1584/.
 */

export type { HabboAssetBadge } from "@/types/furni";

import {
	type HabboGamedataHotel,
	habboExternalTextsUrl,
} from "@/lib/habbo-gamedata-hotel";
import { logger } from "@/lib/logger";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";
import type { HabboAssetBadge } from "@/types/furni";

const BADGE_IMAGE_BASE = "https://images.habbo.com/c_images/album1584";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface BadgeEntry {
	code: string;
	name: string;
	description: string;
}

let badgeCache: BadgeEntry[] | null = null;
let cacheHotel: HabboGamedataHotel | null = null;
let cacheTimestamp = 0;
let loadingPromise: Promise<BadgeEntry[]> | null = null;

/**
 * Fetch and parse all badges from official Habbo external texts.
 * Cached in memory for 30 minutes (per configured hotel).
 */
async function loadBadges(): Promise<{
	badges: BadgeEntry[];
	hotel: HabboGamedataHotel;
}> {
	const hotel = await getHabboGamedataHotel();
	const now = Date.now();
	if (badgeCache && cacheHotel === hotel && now - cacheTimestamp < CACHE_TTL) {
		return { badges: badgeCache, hotel };
	}
	if (loadingPromise) {
		const badges = await loadingPromise;
		return { badges, hotel: cacheHotel ?? hotel };
	}

	loadingPromise = (async () => {
		const url = habboExternalTextsUrl(hotel);
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(20000),
			});

			if (!res.ok) {
				logger.warn(`[badges] Fetch failed: ${res.status}`);
				return badgeCache || [];
			}

			const text = await res.text();
			const lines = text.split("\n");

			const nameMap = new Map<string, string>();
			const descMap = new Map<string, string>();

			for (const line of lines) {
				const eqIdx = line.indexOf("=");
				if (eqIdx === -1) continue;
				const key = line.substring(0, eqIdx).trim();
				const value = line.substring(eqIdx + 1).trim();

				let match = key.match(/^badge_name_(.+)$/);
				if (match) {
					nameMap.set(match[1], value);
					continue;
				}
				match = key.match(/^(.+)_badge_name$/);
				if (match) {
					nameMap.set(match[1], value);
					continue;
				}

				match = key.match(/^badge_desc_(.+)$/);
				if (match) {
					descMap.set(match[1], value);
					continue;
				}
				match = key.match(/^(.+)_badge_desc$/);
				if (match) {
					descMap.set(match[1], value);
				}
			}

			const allCodes = new Set([...nameMap.keys(), ...descMap.keys()]);
			const badges: BadgeEntry[] = [];

			for (const code of allCodes) {
				badges.push({
					code,
					name: nameMap.get(code) || "",
					description: descMap.get(code) || "",
				});
			}

			badges.sort((a, b) => a.code.localeCompare(b.code));

			logger.debug(
				`[badges] Loaded ${badges.length} badges from habbo.${hotel}`,
			);
			badgeCache = badges;
			cacheHotel = hotel;
			cacheTimestamp = Date.now();
			return badges;
		} catch (err) {
			logger.warn("[badges] Load error", { error: (err as Error).message });
			return badgeCache || [];
		} finally {
			loadingPromise = null;
		}
	})();

	const badges = await loadingPromise;
	return { badges, hotel: cacheHotel ?? hotel };
}

/**
 * Search badges from official Habbo external texts.
 * Returns badges with image URLs from images.habbo.com.
 */
export async function searchBadges(
	term: string,
	limit = 100,
	offset = 0,
	_hotel: string | null = null, // API compat; locale comes from CMS settings
): Promise<HabboAssetBadge[]> {
	const { badges, hotel } = await loadBadges();
	const search = term.toLowerCase().trim();

	let filtered = badges;
	if (search) {
		filtered = badges.filter(
			(b) =>
				b.code.toLowerCase().includes(search) ||
				b.name.toLowerCase().includes(search) ||
				b.description.toLowerCase().includes(search),
		);
	} else {
		filtered = [...badges].reverse();
	}

	const page = filtered.slice(offset, offset + limit);

	return page.map((b) => ({
		id: 0,
		code: b.code,
		name: b.name,
		description: b.description,
		hotel,
		url_habbo: `${BADGE_IMAGE_BASE}/${b.code}.gif`,
		url_habboassets: `${BADGE_IMAGE_BASE}/${b.code}.gif`,
	}));
}

/** Clear the badge cache */
export function clearBadgeCache(): void {
	badgeCache = null;
	cacheHotel = null;
	cacheTimestamp = 0;
}
