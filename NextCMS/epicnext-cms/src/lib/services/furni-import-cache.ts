/**
 * In-memory caches for the Studio furni listings.
 *
 * The Studio GET route recomputes three heavy database snapshots plus
 * per-item filesystem checks on every single request:
 *   1. `items_base` → local import index (full table scan)
 *   2. `FurnitureData.json` → normalized classname set (full file parse)
 *   3. `catalog_items.item_ids` → referenced id set (full table scan)
 *   4. one `existsSync` per imported item for .nitro presence
 *
 * All of those are cached here with a short TTL. Mutations (import/delete/
 * regen/sync) clear everything via `clearFurniImportCache()`.
 */

import { sql } from "drizzle-orm";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { bundleExistsInDir } from "@/lib/furni/bundle-file";
import {
	getBaseClassname,
	getSafeClassnameStem,
	normalizeClassname,
} from "@/lib/furni/classname";
import { indexLocalFurniture } from "@/lib/furni/local-presence";
import { logger } from "@/lib/logger";
import { readFurniData } from "./furni-data";

const CACHE_TTL = 30_000; // 30 seconds

type LocalSnapshot = {
	localIndex: Map<string, Array<{ id: number; itemName: string }>>;
	importedSet: Set<string>;
	timestamp: number;
};

let localSnapshot: LocalSnapshot | null = null;

/** Items already present in `items_base`, indexed + flattened to a set. */
export async function getLocalCatalogSnapshot(): Promise<LocalSnapshot> {
	const now = Date.now();
	if (localSnapshot && now - localSnapshot.timestamp < CACHE_TTL) {
		return localSnapshot;
	}
	const rows = await db
		.select({ id: ItemsBase.id, itemName: ItemsBase.itemName })
		.from(ItemsBase);
	const localIndex = indexLocalFurniture(rows);
	const snapshot: LocalSnapshot = {
		localIndex,
		importedSet: new Set(localIndex.keys()),
		timestamp: now,
	};
	localSnapshot = snapshot;
	return snapshot;
}

let furniDataSetSnapshot: { set: Set<string>; timestamp: number } | null = null;

/** Normalized classnames present in the local FurnitureData.json. */
export async function getFurniDataClassnames(): Promise<Set<string>> {
	const now = Date.now();
	if (
		furniDataSetSnapshot &&
		now - furniDataSetSnapshot.timestamp < CACHE_TTL
	) {
		return furniDataSetSnapshot.set;
	}
	const set = new Set<string>();
	try {
		const fd = (await readFurniData()) as {
			roomitemtypes?: { furnitype?: Array<{ classname?: string }> };
			wallitemtypes?: { furnitype?: Array<{ classname?: string }> };
		};
		for (const e of [
			...(fd.roomitemtypes?.furnitype ?? []),
			...(fd.wallitemtypes?.furnitype ?? []),
		]) {
			if (e.classname) set.add(normalizeClassname(e.classname));
		}
	} catch {
		/* best effort — empty set means every item shows "no furnidata" */
	}
	furniDataSetSnapshot = { set, timestamp: now };
	return set;
}

let catalogIdsSnapshot: { set: Set<number>; timestamp: number } | null = null;

/** IDs referenced by any `catalog_items.item_ids`. */
export async function getCatalogIdSet(): Promise<Set<number>> {
	const now = Date.now();
	if (catalogIdsSnapshot && now - catalogIdsSnapshot.timestamp < CACHE_TTL) {
		return catalogIdsSnapshot.set;
	}
	const set = new Set<number>();
	try {
		const rows = await queryRows<{ item_ids: string | null }>(
			sql`SELECT item_ids FROM catalog_items`,
		);
		for (const row of rows) {
			for (const part of String(row.item_ids ?? "").split(/[;,]/)) {
				const n = Number(part.trim());
				if (Number.isFinite(n) && n > 0) set.add(n);
			}
		}
	} catch {
		/* best effort — empty set means every item shows "no catalog entry" */
	}
	catalogIdsSnapshot = { set, timestamp: now };
	return set;
}

const nitroPresenceCache = new Map<string, boolean>();

/** Every classname stem a `.nitro`/`.swf`/icon file may legitimately use. */
function addClassnameStem(set: Set<string>, classname: string): void {
	const normalized = classname.trim().toLowerCase();
	if (!normalized) return;
	const base = getBaseClassname(normalized).toLowerCase();
	if (base) set.add(base);
	if (normalized.includes("*")) {
		const safe = getSafeClassnameStem(normalized).toLowerCase();
		if (safe) set.add(safe);
	}
}

let cleanupStemsSnapshot: { set: Set<string>; timestamp: number } | null = null;

/**
 * Authoritative stems for the nitro-cleanup scan: every `item_name` plus the
 * `public_name` fallback (mirroring repair-nitros.ts resolution). Cached the
 * same way as the Studio listings so repeated scans (auto-clean, panel) don't
 * re-query `items_base` on every call.
 */
export async function getCleanupValidStems(): Promise<Set<string>> {
	const now = Date.now();
	if (
		cleanupStemsSnapshot &&
		now - cleanupStemsSnapshot.timestamp < CACHE_TTL
	) {
		return cleanupStemsSnapshot.set;
	}
	const set = new Set<string>();
	try {
		const rows = await queryRows<{
			item_name: string;
			public_name: string;
		}>(sql`SELECT item_name, public_name FROM items_base`);
		for (const row of rows) {
			addClassnameStem(set, row.item_name);
			if (
				row.public_name &&
				row.public_name !== row.item_name &&
				!row.public_name.includes(" ") &&
				row.public_name !== "0"
			) {
				addClassnameStem(set, row.public_name);
			}
		}
	} catch {
		/* empty set → every asset is treated as orphaned */
	}
	cleanupStemsSnapshot = { set, timestamp: now };
	return set;
}

/** `existsSync` memoized per (dir + base) — bundle files change rarely. */
export function nitroExistsCached(dir: string, base: string): boolean {
	const key = `${dir}/${base}`;
	const cached = nitroPresenceCache.get(key);
	if (cached !== undefined) return cached;
	const present = bundleExistsInDir(dir, base);
	nitroPresenceCache.set(key, present);
	return present;
}

type FurniStats = {
	totalInDb: number;
	inCatalog: number;
	notInCatalog: number;
	missingNitro: number;
};

let statsSnapshot: { stats: FurniStats; timestamp: number } | null = null;

/**
 * Studio header stats. Falls back to a previously cached result if the
 * expensive scan (all of items_base + a 10k filesystem probe) fails.
 */
export async function getFurniImportStats(
	nitroDir: string,
): Promise<FurniStats> {
	const now = Date.now();
	if (statsSnapshot && now - statsSnapshot.timestamp < CACHE_TTL) {
		return statsSnapshot.stats;
	}
	try {
		const [totalInDbRaw, inCatalogRaw, allIds, referencedList] =
			await Promise.all([
				queryRows<{ cnt: bigint }>(sql`SELECT COUNT(*) as cnt FROM items_base`),
				queryRows<{ cnt: bigint }>(
					sql`SELECT COUNT(DISTINCT item_ids) as cnt FROM catalog_items`,
				),
				queryRows<{ id: number }>(sql`SELECT id FROM items_base`),
				queryRows<{ item_ids: string | null }>(
					sql`SELECT item_ids FROM catalog_items`,
				),
			]);

		const totalInDb = Number(totalInDbRaw[0]?.cnt ?? 0);
		const inCatalog = Number(inCatalogRaw[0]?.cnt ?? 0);

		const allIdsNum = allIds.map((r) => Number(r.id));
		const referenced = new Set<number>();
		for (const row of referencedList) {
			for (const part of String(row.item_ids ?? "").split(/[;,]/)) {
				const n = Number(part.trim());
				if (Number.isFinite(n) && n > 0) referenced.add(n);
			}
		}
		const notInCatalog = allIdsNum.filter((id) => !referenced.has(id)).length;

		const importedItems = await queryRows<{ item_name: string }>(sql`
        SELECT ib.item_name FROM items_base ib
        WHERE EXISTS (
          SELECT 1 FROM catalog_items ci
          WHERE FIND_IN_SET(ib.id, REPLACE(ci.item_ids, ';', ',')) > 0
        )
        LIMIT 10000
      `);

		let missingNitro = 0;
		for (const item of importedItems) {
			const starIdx = item.item_name.indexOf("*");
			const base =
				starIdx !== -1 ? item.item_name.substring(0, starIdx) : item.item_name;
			if (!nitroExistsCached(nitroDir, base)) missingNitro++;
		}

		const stats: FurniStats = {
			totalInDb,
			inCatalog,
			notInCatalog,
			missingNitro,
		};
		statsSnapshot = { stats, timestamp: now };
		return stats;
	} catch (err) {
		logger.warn(
			`[furni-import-cache] Stats scan failed: ${(err as Error).message}`,
		);
		return (
			statsSnapshot?.stats ?? {
				totalInDb: 0,
				inCatalog: 0,
				notInCatalog: 0,
				missingNitro: 0,
			}
		);
	}
}

/** Drop every cache after a mutation so the next Studio request is fresh. */
export function clearFurniImportCache(): void {
	localSnapshot = null;
	furniDataSetSnapshot = null;
	catalogIdsSnapshot = null;
	nitroPresenceCache.clear();
	cleanupStemsSnapshot = null;
	statsSnapshot = null;
}
