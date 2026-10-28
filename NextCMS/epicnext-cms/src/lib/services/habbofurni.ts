import { normalizeClassname } from "@/lib/furni/classname";
/**
 * Furniture search & listing — powered by official Habbo furnidata.
 *
 * Hotel locale comes from CMS setting `habbo_gamedata_hotel`.
 * No third-party APIs (habbofurni.com) needed.
 */

import { logger } from "@/lib/logger";
import type { FurniListResult, HabboFurniItem } from "@/types/furni";
import { getOfficialHabboFurnidata } from "./habbo-furnidata-cache";

export type { FurniListResult, HabboFurniItem };

// ── List / Browse endpoint ────────────────────────────────────────

/**
 * List furniture from official Habbo furnidata with optional search and pagination.
 * Data comes from the configured hotel furnidata_json (cached 30 min).
 */
export async function listFurniture(
	options: {
		search?: string;
		page?: number;
		perPage?: number;
		/**
		 * Optional set of already-imported classnames. When provided, non-imported
		 * items are sorted to the top so the user finds them on page 1 instead of
		 * paging through 15+ pages of already-imported newest items.
		 */
		importedSet?: Set<string>;
	} = {},
): Promise<FurniListResult> {
	const empty: FurniListResult = {
		items: [],
		meta: { currentPage: 1, lastPage: 1, total: 0, perPage: 50 },
	};
	const perPage = Math.min(options.perPage || 50, 100);
	const page = options.page || 1;
	const search = options.search?.toLowerCase().trim() || "";
	const importedSet = options.importedSet
		? new Set([...options.importedSet].map(normalizeClassname))
		: undefined;

	try {
		const map = await getOfficialHabboFurnidata();
		if (map.size === 0) return empty;

		// Convert to array and optionally filter by search
		let items = Array.from(map.values());

		if (search) {
			items = items.filter(
				(item) =>
					item.classname.toLowerCase().includes(search) ||
					item.name.toLowerCase().includes(search) ||
					item.description.toLowerCase().includes(search),
			);
		}

		if (importedSet) {
			// Non-imported first (id desc), then imported (id desc).
			items.sort((a, b) => {
				const aImp = importedSet.has(normalizeClassname(a.classname)) ? 1 : 0;
				const bImp = importedSet.has(normalizeClassname(b.classname)) ? 1 : 0;
				if (aImp !== bImp) return aImp - bImp;
				return b.id - a.id;
			});
		} else {
			// Sort by id descending (newest first)
			items.sort((a, b) => b.id - a.id);
		}

		const total = items.length;
		const lastPage = Math.max(Math.ceil(total / perPage), 1);
		const start = (page - 1) * perPage;
		const pageItems = items.slice(start, start + perPage);

		return {
			items: pageItems.map((item) => ({
				id: item.id,
				classname: item.classname,
				name: item.name || item.classname,
				description: item.description || "",
				type: item.itemType === "i" ? "wallitem" : "flooritem",
				revision: item.revision,
				category: item.category || item.furniline || "",
			})),
			meta: { currentPage: page, lastPage, total, perPage },
		};
	} catch (err) {
		logger.warn("[furni] List error", { error: (err as Error).message });
		return empty;
	}
}

// ── Search endpoint ────────────────────────────────────────────────

/**
 * Search furniture by query string.
 */

// ── Direct lookup by classname ─────────────────────────────────────

/**
 * Get a single furniture item by classname.
 * Uses cached furnidata from the configured official Habbo hotel.
 */
export async function getFurnitureByClassname(
	classname: string,
): Promise<HabboFurniItem | null> {
	const map = await getOfficialHabboFurnidata();

	// Try exact match
	let entry = map.get(classname);

	// Try without color variant
	if (!entry && classname.includes("*")) {
		const base = classname.split("*")[0];
		entry = map.get(`${base}*0`) || map.get(base);
	}

	// Try with *0
	if (!entry && !classname.includes("*")) {
		entry = map.get(`${classname}*0`);
	}

	if (!entry) return null;

	return {
		id: entry.id,
		classname: entry.classname,
		name: entry.name || entry.classname,
		description: entry.description || "",
		type: entry.itemType === "i" ? "wallitem" : "flooritem",
		revision: entry.revision,
		category: entry.category || entry.furniline || "",
	};
}

// ── Batch lookup ───────────────────────────────────────────────────

/**
 * Batch lookup: get data for a list of classnames.
 * Much faster than the old habbofurni.com API — single cache lookup, no network.
 */
export async function batchLookupByClassnames(
	classnames: string[],
): Promise<Map<string, HabboFurniItem>> {
	const result = new Map<string, HabboFurniItem>();
	if (classnames.length === 0) return result;

	// Parallel lookup — all share the same in-memory furnidata cache
	const lookedUp = await Promise.all(
		classnames.map((cn) => getFurnitureByClassname(cn)),
	);

	for (let i = 0; i < classnames.length; i++) {
		const item = lookedUp[i];
		if (item?.name) result.set(classnames[i], item);
	}

	return result;
}
