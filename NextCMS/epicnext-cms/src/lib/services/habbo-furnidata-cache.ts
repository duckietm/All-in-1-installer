/**
 * Official Habbo furnidata cache — hotel chosen in CMS settings
 * (`habbo_gamedata_hotel`). Downloads once per hotel, keeps in memory.
 */

export type { OfficialHabboFurniEntry } from "@/types/furni";

import {
	type HabboGamedataHotel,
	habboFurnidataUrl,
} from "@/lib/habbo-gamedata-hotel";
import { logger } from "@/lib/logger";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";
import { browserHeaders } from "@/lib/services/import/core/browser-headers";
import type { OfficialHabboFurniEntry } from "@/types/furni";

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cache: Map<string, OfficialHabboFurniEntry> | null = null;
let cacheHotel: HabboGamedataHotel | null = null;
let cacheTimestamp = 0;
let loading: Promise<Map<string, OfficialHabboFurniEntry>> | null = null;

/**
 * Fetches and parses the full official Habbo furnidata JSON for the
 * configured hotel. Results are cached in memory for 30 minutes.
 */
export async function getOfficialHabboFurnidata(): Promise<
	Map<string, OfficialHabboFurniEntry>
> {
	const hotel = await getHabboGamedataHotel();
	const now = Date.now();

	if (cache && cacheHotel === hotel && now - cacheTimestamp < CACHE_TTL) {
		return cache;
	}

	if (loading) return loading;

	loading = (async () => {
		const url = habboFurnidataUrl(hotel);
		try {
			logger.debug(`[habbo-furnidata] Fetching furnidata from ${url}...`);
			const res = await fetch(url, {
				signal: AbortSignal.timeout(20000),
				headers: browserHeaders(),
			});

			if (!res.ok) {
				logger.warn(`[habbo-furnidata] Fetch failed: ${res.status}`);
				return cache || new Map();
			}

			const data = await res.json();
			const map = new Map<string, OfficialHabboFurniEntry>();

			const roomTypes = data?.roomitemtypes?.furnitype;
			if (Array.isArray(roomTypes)) {
				for (const item of roomTypes) {
					if (!item.classname) continue;
					map.set(item.classname, {
						id: item.id ?? 0,
						classname: item.classname,
						revision: item.revision ?? 0,
						category: item.category ?? "",
						defaultdir: item.defaultdir ?? 0,
						xdim: item.xdim ?? 1,
						ydim: item.ydim ?? 1,
						partcolors: item.partcolors ?? { color: [] },
						name: item.name ?? "",
						description: item.description ?? "",
						specialtype: item.specialtype ?? 0,
						canstandon: item.canstandon ?? false,
						cansiton: item.cansiton ?? false,
						canlayon: item.canlayon ?? false,
						furniline: item.furniline ?? "",
						environment: item.environment ?? "",
						rare: item.rare ?? false,
						tradeable: item.tradeable,
						bc: item.bc,
						customparams: item.customparams,
						itemType: "s",
					});
				}
			}

			const wallTypes = data?.wallitemtypes?.furnitype;
			if (Array.isArray(wallTypes)) {
				for (const item of wallTypes) {
					if (!item.classname) continue;
					map.set(item.classname, {
						id: item.id ?? 0,
						classname: item.classname,
						revision: item.revision ?? 0,
						category: item.category ?? "",
						defaultdir: item.defaultdir ?? 0,
						xdim: item.xdim ?? 1,
						ydim: item.ydim ?? 1,
						partcolors: item.partcolors ?? { color: [] },
						name: item.name ?? "",
						description: item.description ?? "",
						specialtype: item.specialtype ?? 0,
						canstandon: item.canstandon ?? false,
						cansiton: item.cansiton ?? false,
						canlayon: item.canlayon ?? false,
						furniline: item.furniline ?? "",
						environment: item.environment ?? "",
						rare: item.rare ?? false,
						tradeable: item.tradeable,
						bc: item.bc,
						customparams: item.customparams,
						itemType: "i",
					});
				}
			}

			logger.debug(
				`[habbo-furnidata] Cached ${map.size} items from habbo.${hotel} (${roomTypes?.length ?? 0} room + ${wallTypes?.length ?? 0} wall)`,
			);
			cache = map;
			cacheHotel = hotel;
			cacheTimestamp = Date.now();
			return map;
		} catch (err) {
			logger.warn("[habbo-furnidata] Fetch error", {
				error: (err as Error).message,
			});
			return cache || new Map();
		} finally {
			loading = null;
		}
	})();

	return loading;
}

/**
 * Lookup a single item by classname from official Habbo furnidata.
 * Tries exact match first, then base classname (without color variant).
 */
export async function lookupOfficialHabboFurni(
	classname: string,
): Promise<OfficialHabboFurniEntry | null> {
	const map = await getOfficialHabboFurnidata();

	const exact = map.get(classname);
	if (exact) return exact;

	if (classname.includes("*")) {
		const base = classname.split("*")[0];
		const variant0 = map.get(`${base}*0`);
		if (variant0) return variant0;
		const baseMatch = map.get(base);
		if (baseMatch) return baseMatch;
	}

	if (!classname.includes("*")) {
		const withVariant = map.get(`${classname}*0`);
		if (withVariant) return withVariant;
	}

	return null;
}

/** Clear the cache (e.g. after changing habbo_gamedata_hotel). */
export function clearOfficialHabboFurnidataCache(): void {
	cache = null;
	cacheHotel = null;
	cacheTimestamp = 0;
}
