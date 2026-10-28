import "server-only";

import { nitroAnimationStatesCount } from "@/lib/furni/auto-interaction";
import { readFurniData } from "@/lib/services/furni-data";
import { getOfficialHabboFurnidata } from "@/lib/services/habbo-furnidata-cache";

export { nitroAnimationStatesCount };

/**
 * Real interaction flags sourced from the authoritative furnidata instead of
 * classname/name keywords. This is what makes auto-detection 100% accurate
 * (no false positives) — every item's canSit/canLay/canStand comes from the
 * real furniture data (SWF logic XML / official Habbo furnidata / bundled
 * FurnitureData.json), never from a guessed keyword.
 */

export interface RealFurniFlags {
	cansiton: boolean;
	canlayon: boolean;
	canstandon: boolean;
	specialtype: number;
	source: "local" | "habbo" | "none";
}

const LOCAL_CACHE_TTL_MS = 60_000;
type LocalFlags = Omit<RealFurniFlags, "source"> & { __rev?: number };
let localMap: Map<string, LocalFlags> | null = null;
let localMapAt = 0;

async function loadLocalFurniFlags(): Promise<Map<string, LocalFlags>> {
	if (localMap && Date.now() - localMapAt < LOCAL_CACHE_TTL_MS) return localMap;
	try {
		const data = (await readFurniData()) as Record<
			string,
			{
				furnitype?: Array<Record<string, unknown>>;
			}
		>;
		const map = new Map<string, LocalFlags>();
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const item of data[section]?.furnitype ?? []) {
				const classname = item.classname as string | undefined;
				if (!classname) continue;
				const candidate: LocalFlags = {
					cansiton: !!item.cansiton,
					canlayon: !!item.canlayon,
					canstandon: !!item.canstandon,
					specialtype: Number(item.specialtype) || 0,
					__rev: Number(item.revision) || 0,
				};
				const existing = map.get(classname);
				if (!existing) {
					map.set(classname, candidate);
					continue;
				}
				// Duplicate classnames exist (stale placeholder rows at a higher
				// revision with cleared flags, plus the real entry). A flag that
				// is true in ANY entry is authoritative — a placeholder never
				// invents a flag, it only clears one. This keeps e.g. a real
				// rev-45508 "club_sofa" (cansiton) from being shadowed by a
				// rev-59005 row that reset everything to false.
				existing.cansiton = existing.cansiton || candidate.cansiton;
				existing.canlayon = existing.canlayon || candidate.canlayon;
				existing.canstandon = existing.canstandon || candidate.canstandon;
				existing.specialtype = Math.max(
					existing.specialtype,
					candidate.specialtype,
				);
			}
		}
		localMap = map;
		localMapAt = Date.now();
		return map;
	} catch {
		localMap = new Map();
		localMapAt = Date.now();
		return localMap;
	}
}

/**
 * Look up the real interaction flags for a classname. Priority:
 *  1. Local furnidata (the CMS-maintained FurnitureData.json, reconciled
 *     against items_base on every import).
 *  2. Official Habbo furnidata for the configured hotel.
 * Returns `{ source: "none" }` when nothing is known — callers should then
 * fall back to keyword detection rather than guessing.
 */
export async function lookupRealFurniFlags(
	classname: string,
): Promise<RealFurniFlags> {
	const base = classname.split("*")[0];

	const local = await loadLocalFurniFlags();
	const localHit = local.get(classname) ?? local.get(base);
	if (localHit) return { ...localHit, source: "local" };

	try {
		const habbo = await getOfficialHabboFurnidata();
		const h = habbo.get(classname) ?? habbo.get(base);
		if (h) {
			return {
				cansiton: h.cansiton,
				canlayon: h.canlayon,
				canstandon: h.canstandon,
				specialtype: h.specialtype,
				source: "habbo",
			};
		}
	} catch {
		// official cache unavailable — fall through to "none"
	}

	return {
		cansiton: false,
		canlayon: false,
		canstandon: false,
		specialtype: 0,
		source: "none",
	};
}
