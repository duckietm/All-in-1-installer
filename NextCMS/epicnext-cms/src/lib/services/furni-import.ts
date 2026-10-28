import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { CatalogPages, db, execResult, ItemsBase, queryRows } from "@/lib/db";
import {
	bundleExistsInDir,
	bundleFileNames,
	bundleWritePathInDir,
	resolveBundleInDir,
	stripBundleExt,
} from "@/lib/furni/bundle-file";
import { isSafeAssetName, LOCAL_BUNDLE_EXT } from "@/lib/furni/classname";
import { offerPurchasabilityProblems } from "@/lib/furni/offer-purchasability";
import { officialHabboEnrichmentWarning } from "@/lib/habbo-gamedata-hotel";
import { logger } from "@/lib/logger";
import { logServerError } from "@/lib/server-log";
import {
	DEFAULT_FURNI_NITRO_DIR,
	getFurniAssetDirs,
	getFurniAssetWriteTargets,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import {
	appendFurniEntry,
	buildFurniEntry,
	findFurniDataIdConflict,
	getFurnitureDataWritePaths,
	removeFurniEntry,
} from "@/lib/services/furni-data";
import { diagnosticAssetUrl } from "@/lib/services/furniture-source-assets";
import {
	lookupOfficialHabboFurni,
	type OfficialHabboFurniEntry,
} from "@/lib/services/habbo-furnidata-cache";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";
import {
	downloadFile,
	tryDownloadCandidates,
} from "@/lib/services/import/core/download";
import {
	type ConversionResult,
	convertSwfToNitroAsync,
	extractIconFromSwfAsync,
	parseNitroBundle,
} from "@/lib/services/swf-to-nitro";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import type { ImportSingleResult } from "@/types/furni";
import { extractFurniIconPng } from "./clone-icon";
import { reserveFurnitureId } from "./furniture-id-reservation";

// Re-export the download helpers now owned by the shared import core.
// Existing furni callers keep importing them from here.
export { downloadFile };

// ── Constants ────────────────────────────────────────────────────────

// turbopackIgnore hints: this module is reached by App Router routes; without
// them Turbopack's NFT tracer marks the whole project as a dependency because
// it can't prove the dynamic suffixes (file names) are bounded to the prefix.
export const FURNI_NITRO_DIR = DEFAULT_FURNI_NITRO_DIR;

export const IMPORTED_PAGE_CAPTION_SAVE = "imported_furni";
export const IMPORTED_PAGE_CAPTION = "Imported Furniture";

// Shared with the admin Studio via the client-safe auto-catalog module so the
// on-screen preview always matches what the emulator import applies.
export { CATEGORY_PAGE } from "@/lib/furni/auto-catalog";

import { CATEGORY_PAGE } from "@/lib/furni/auto-catalog";
import { autoDetectInteraction } from "@/lib/furni/auto-interaction";
import {
	lookupRealFurniFlags,
	nitroAnimationStatesCount,
} from "@/lib/services/furni-real-interaction";

// ── Helpers ──────────────────────────────────────────────────────────

export async function ensureDirectories(): Promise<void> {
	const targets = await getFurniAssetWriteTargets();
	const dirs = [
		targets.swfDir,
		targets.iconDir,
		targets.nitroDir,
		...targets.mirrorDirs.flatMap((d) => [d.swfDir, d.iconDir, d.nitroDir]),
	];
	await Promise.all(
		dirs
			.filter((dir) => !existsSync(/*turbopackIgnore: true*/ dir))
			.map((dir) =>
				fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true }),
			),
	);
}

async function mirrorFileToDirs(
	sourcePath: string,
	fileName: string,
	dirs: string[],
	warnings?: string[],
): Promise<void> {
	if (!existsSync(/*turbopackIgnore: true*/ sourcePath)) return;

	for (const dir of dirs) {
		const targetPath = getRuntimePath(/*turbopackIgnore: true*/ dir, fileName);
		const sourceKey =
			process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
		const targetKey =
			process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
		if (sourceKey === targetKey) continue;

		try {
			await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
			await fs.copyFile(
				/*turbopackIgnore: true*/ sourcePath,
				/*turbopackIgnore: true*/ targetPath,
			);
		} catch (err) {
			warnings?.push(
				`Mirror copy failed for ${fileName}: ${(err as Error).message}`,
			);
		}
	}
}

export function buildItemsBaseEnrichmentUpdate(params: {
	id: number;
	dims: { x: number; y: number; z: number };
	cansiton: boolean;
	canlayon: boolean;
	canstandon: boolean;
	allowStack: string;
	interactionType: string;
	interactionModesCount?: number;
}): SQL {
	const modesCount = params.interactionModesCount ?? 0;
	return sql`
      UPDATE items_base
      SET width = ${params.dims.x}, length = ${params.dims.y}, stack_height = ${params.dims.z},
          allow_sit = ${params.cansiton ? "1" : "0"},
          allow_lay = ${params.canlayon ? "1" : "0"},
          allow_walk = ${params.canstandon ? "1" : "0"},
          allow_stack = ${params.allowStack},
          interaction_type = ${params.interactionType},
          interaction_modes_count = ${modesCount}
      WHERE id = ${params.id}
    `;
}

/** Keep the lowest-id row for a catalog page and delete any duplicate created
 * concurrently by a racing import. Returns the surviving page id. */
async function dedupeCatalogPage(
	captionSave: string,
	parentId: number,
	justCreatedId: number,
): Promise<number> {
	const rows = await queryRows<{ id: number }>(sql`
    SELECT MIN(id) AS id FROM catalog_pages
    WHERE caption_save = ${captionSave} AND parent_id = ${parentId}
  `);
	const winner = rows[0]?.id ?? justCreatedId;
	if (winner !== justCreatedId) {
		// Never delete a page that already received catalog items.
		await db.execute(sql`
      DELETE FROM catalog_pages
      WHERE id = ${justCreatedId}
        AND NOT EXISTS (SELECT 1 FROM catalog_items WHERE page_id = ${justCreatedId})
    `);
	}
	return winner;
}

/** Get or create the root "Imported Furniture" parent page (no items directly on this page).
 * Caches the page ID in-memory for the process lifetime to avoid redundant DB reads
 * during batch imports */
export async function getOrCreateImportedParentPage(): Promise<number> {
	const [existing] = await db
		.select({ id: CatalogPages.id })
		.from(CatalogPages)
		.where(eq(CatalogPages.captionSave, IMPORTED_PAGE_CAPTION_SAVE))
		.limit(1);
	if (existing) {
		parentIdCache = existing.id;
		return existing.id;
	}

	// Use raw SQL to avoid ENUM mismatch (page_layout, visible, enabled)
	// All string columns must be '' (not NULL) or the Java emulator may skip the page
	await db.execute(sql`
    INSERT INTO catalog_pages (caption_save, caption, page_layout, parent_id, min_rank, order_num, icon_image, enabled, visible, includes, page_headline, page_teaser, page_special, page_text1, page_text2, page_text_details, page_text_teaser)
    VALUES (${IMPORTED_PAGE_CAPTION_SAVE}, ${IMPORTED_PAGE_CAPTION}, 'default_3x3', -1, '1', 9999, 263, '1', '1', '', '', '', '', '', '', '', '')
  `);
	const [created] = await db
		.select({ id: CatalogPages.id })
		.from(CatalogPages)
		.where(eq(CatalogPages.captionSave, IMPORTED_PAGE_CAPTION_SAVE))
		.limit(1);
	if (!created) {
		throw new Error(
			'Failed to create "Imported Furniture" parent catalog page',
		);
	}
	parentIdCache = await dedupeCatalogPage(
		IMPORTED_PAGE_CAPTION_SAVE,
		-1,
		created.id,
	);
	return parentIdCache;
}

/** Determine the catalog category for a furniture item based on its classname and type. */
export { classifyFurni } from "@/lib/furni/auto-catalog";

import { classifyFurni } from "@/lib/furni/auto-catalog";

/**
 * Auto-detect catalog price from classname.
 * - CF_750_xxx → cost_credits = 750 (credit furni = the credit value it represents)
 * - exe_50, exe_100, exe_200 etc. → cost_credits based on exchange value
 * - rare_xxx → cost_credits = 25 (rares are expensive)
 * - wf_xxx → cost_credits = 5 (wired components)
 * - everything else → cost_credits = 3 (default)
 *
 * Returns { credits, points, pointsType }
 */
export { autoPriceFurni } from "@/lib/furni/auto-catalog";

import { autoPriceFurni } from "@/lib/furni/auto-catalog";
import { toWebpLosslessBundle } from "@/lib/services/swf/nitro-builder";

/**
 * Store an incoming .nitro as WebP Lossless, whatever format it arrived in, so
 * every import path ends up with the same on-disk format as the SWF importer.
 * A texture that cannot be decoded is kept as-is with a warning: the bundle
 * itself is valid, and dropping a furniture item over a codec edge case is
 * worse than a slightly larger texture.
 */
async function toWebpLosslessOrKeep(
	bundle: Buffer,
	warnings: string[],
): Promise<Buffer> {
	try {
		return await toWebpLosslessBundle(bundle);
	} catch {
		warnings.push("texture kept in its original format");
		return bundle;
	}
}

/** Get or create a category sub-page under the imported parent page.
 * Caches category page IDs in-memory for CATEGORY_CACHE_TTL_MS to avoid
 * redundant DB lookups during batch imports where many items map to the same
 * category. */
let categoryPageCache: Map<string, number> | null = null;
let categoryCacheTimestamp = 0;
const CATEGORY_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

export async function getOrCreateCategoryPage(
	classname: string,
	itemType: string,
): Promise<number> {
	const parentId = await getOrCreateImportedParentPage();
	const catKey = classifyFurni(classname, itemType);
	const captionSave = `imp_${catKey}`;

	// Check in-memory cache (TTL based)
	const now = Date.now();
	if (
		categoryPageCache &&
		now - categoryCacheTimestamp < CATEGORY_CACHE_TTL_MS
	) {
		const cached = categoryPageCache.get(captionSave);
		if (cached !== undefined) return cached;
	}

	const catInfo = CATEGORY_PAGE[catKey] || CATEGORY_PAGE.other;

	const [existing] = await db
		.select({ id: CatalogPages.id })
		.from(CatalogPages)
		.where(
			and(
				eq(CatalogPages.captionSave, captionSave),
				eq(CatalogPages.parentId, parentId),
			),
		)
		.limit(1);
	if (existing) {
		if (!categoryPageCache) categoryPageCache = new Map();
		categoryPageCache.set(captionSave, existing.id);
		return existing.id;
	}

	await db.execute(sql`
    INSERT INTO catalog_pages (caption_save, caption, page_layout, parent_id, min_rank, order_num, icon_image, enabled, visible, includes, page_headline, page_teaser, page_special, page_text1, page_text2, page_text_details, page_text_teaser)
    VALUES (${captionSave}, ${catInfo.label}, 'default_3x3', ${parentId}, '1', ${catInfo.order}, ${catInfo.icon}, '1', '1', '', '', '', '', '', '', '', '')
  `);

	const [created] = await db
		.select({ id: CatalogPages.id })
		.from(CatalogPages)
		.where(
			and(
				eq(CatalogPages.captionSave, captionSave),
				eq(CatalogPages.parentId, parentId),
			),
		)
		.limit(1);
	if (!created) {
		throw new Error(
			`Failed to create catalog sub-page "${captionSave}" under parent ${parentId}`,
		);
	}
	if (!categoryPageCache) categoryPageCache = new Map();
	const winner = await dedupeCatalogPage(captionSave, parentId, created.id);
	categoryPageCache.set(captionSave, winner);
	return winner;
}

export function resetCatalogPageCache(): void {
	parentIdCache = null;
	categoryPageCache = null;
	categoryCacheTimestamp = 0;
}

/**
 * Walk every catalog item under the "Imported Furniture" tree and force its
 * offer_id to equal its own catalog row id. Fixes any stale values (e.g.
 * legacy -1 rows) after an import.
 */
export async function reconcileImportedOfferIds(): Promise<{
	fixed: number;
}> {
	const parentId = await getOrCreateImportedParentPage();
	const result = await execResult(sql`
    UPDATE catalog_items ci
    JOIN catalog_pages cp ON cp.id = ci.page_id
    SET ci.offer_id = ci.id
    WHERE cp.parent_id = ${parentId}
      AND ci.offer_id <> ci.id
  `);
	return { fixed: Number(result.affectedRows ?? 0) };
}

const execFileAsync = promisify(execFile);

/**
 * Ensure the furni asset directories (icons, nitros, swf) and the folders
 * holding FurnitureData.json are owned by www-data:www-data, so nginx and the
 * emulator can always read freshly imported files. Best-effort: if chown is
 * unavailable or fails (e.g. running unprivileged), a warning is logged and
 * import continues.
 */
export async function ensureFurniOwnership(): Promise<{ fixed: string[] }> {
	if (process.platform === "win32") return { fixed: [] };

	const { swfDir, iconDir, nitroDir, mirrorDirs } =
		await getFurniAssetWriteTargets();
	const furniDataPaths = await getFurnitureDataWritePaths();

	const dirs = [
		swfDir,
		iconDir,
		nitroDir,
		...mirrorDirs.flatMap((m) => [m.swfDir, m.iconDir, m.nitroDir]),
		...furniDataPaths.map((p) => path.dirname(p)),
	]
		.map((d) => path.normalize(d))
		.filter((d, i, arr) => arr.indexOf(d) === i && existsSync(d));

	if (dirs.length === 0) return { fixed: [] };

	try {
		await execFileAsync("chown", ["-R", "www-data:www-data", ...dirs]);
		return { fixed: dirs };
	} catch (err) {
		logger.warn("[import-furni] chown to www-data failed", {
			dirs,
			error: (err as Error).message,
		});
		return { fixed: [] };
	}
}

/** Copy a single missing file from source dir into target dir; logs on failure. */
async function copyIfMissing(
	sourceDir: string,
	targetDir: string,
	entry: string,
	copied: string[],
): Promise<void> {
	const dest = getRuntimePath(targetDir, entry);
	if (existsSync(dest)) return;
	try {
		await fs.copyFile(getRuntimePath(sourceDir, entry), dest);
		copied.push(entry);
	} catch (err) {
		logger.warn("[import-furni] gamedata bundle sync copy failed", {
			entry,
			error: (err as Error).message,
		});
	}
}

/** Scan a source dir and copy every file that is missing from the target dir. */
async function syncDirMissingFiles(
	sourceDir: string,
	targetDir: string,
	predicate: (entry: string) => boolean,
): Promise<string[]> {
	if (!existsSync(sourceDir)) return [];
	try {
		await fs.mkdir(targetDir, { recursive: true });
	} catch {
		return [];
	}
	const copied: string[] = [];
	try {
		const entries = await fs.readdir(sourceDir);
		for (const entry of entries) {
			if (!predicate(entry)) continue;
			await copyIfMissing(sourceDir, targetDir, entry, copied);
		}
	} catch (err) {
		logger.warn("[import-furni] gamedata bundle sync scan failed", {
			error: (err as Error).message,
		});
	}
	return copied;
}

/**
 * Backfill any nitro and icon files missing from the emulator's Gamedata
 * bundle (/var/www/Gamedata/bundled/furniture and /var/www/Gamedata/icons)
 * so all imported furniture stays renderable in-game even when a mirror
 * write was skipped.
 */
export async function syncAssetsToGamedataBundle(): Promise<{
	copiedNitros: string[];
	copiedIcons: string[];
}> {
	if (process.platform === "win32")
		return { copiedNitros: [], copiedIcons: [] };

	const gamedataRoot = await getGamedataRoot();
	if (!gamedataRoot) return { copiedNitros: [], copiedIcons: [] };

	const { nitroDir, iconDir } = await getFurniAssetDirs();

	const copiedNitros: string[] = [];
	const copiedIcons: string[] = [];

	const nitroTarget = /*turbopackIgnore: true*/ getRuntimePath(
		gamedataRoot,
		"bundled/furniture",
	);
	if (nitroDir !== nitroTarget) {
		const copied = await syncDirMissingFiles(
			nitroDir,
			nitroTarget,
			(entry) => stripBundleExt(entry) !== null,
		);
		copiedNitros.push(...copied);
	}

	const iconTarget = /*turbopackIgnore: true*/ getRuntimePath(
		gamedataRoot,
		"icons",
	);
	if (iconDir !== iconTarget) {
		const copied = await syncDirMissingFiles(iconDir, iconTarget, (entry) =>
			entry.endsWith("_icon.png"),
		);
		copiedIcons.push(...copied);
	}

	return { copiedNitros, copiedIcons };
}

/**
 * Allocate the next `catalog_items.id` and run the INSERT through a
 * process-level async mutex so concurrent imports in the same Node process
 * cannot race on MAX(id). A DB-level lock would require pinning a single
 * connection for the whole operation; the in-process mutex is enough
 * for the single-server deployment and avoids pool-connection gymnastics.
 */
let catalogNextId: number | null = null;
let catalogIdLastUsed = 0;
let catalogIdSeedChain: Promise<void> = Promise.resolve();
const CATALOG_ID_REFRESH_MS = 60_000;

let parentIdCache: number | null = null;

/** Allocate a unique catalog_items id. Seeded once with MAX(id)+1, then handed
 *  out from an in-process counter so concurrent imports don't serialize on a
 *  SELECT MAX + INSERT round-trip per item. Re-seeds when idle so rows added
 *  externally don't collide. */
export async function allocateCatalogItemId<T>(
	insertFn: (nextId: number) => Promise<T>,
): Promise<T> {
	const now = Date.now();
	if (
		catalogNextId === null ||
		now - catalogIdLastUsed > CATALOG_ID_REFRESH_MS
	) {
		let settle!: () => void;
		const prev = catalogIdSeedChain;
		catalogIdSeedChain = new Promise<void>((r) => {
			settle = r;
		});
		await prev.catch((error) =>
			logServerError("furni.catalog_id_chain_failed", error),
		);
		try {
			if (
				catalogNextId === null ||
				Date.now() - catalogIdLastUsed > CATALOG_ID_REFRESH_MS
			) {
				const maxIdResult = await queryRows<{
					maxId: number | bigint | null;
				}>(sql`
					SELECT MAX(id) as maxId FROM catalog_items
				`);
				catalogNextId = Number(maxIdResult[0]?.maxId ?? 0) + 1;
			}
		} finally {
			settle();
		}
	}
	catalogIdLastUsed = Date.now();
	const nextId = catalogNextId;
	catalogNextId += 1;
	return await insertFn(nextId);
}

/** Reserveer N sequentiële catalog item IDs uit de in-process counter, zonder
 * per-item transaction. Gebruikt door bulk insert paden. */
export async function reserveCatalogItemIds(count: number): Promise<number[]> {
	if (count <= 0) return [];

	const now = Date.now();
	if (
		catalogNextId === null ||
		now - catalogIdLastUsed > CATALOG_ID_REFRESH_MS
	) {
		let settle!: () => void;
		const prev = catalogIdSeedChain;
		catalogIdSeedChain = new Promise<void>((r) => {
			settle = r;
		});
		await prev.catch((error) =>
			logServerError("furni.catalog_id_chain_failed", error),
		);
		try {
			if (
				catalogNextId === null ||
				Date.now() - catalogIdLastUsed > CATALOG_ID_REFRESH_MS
			) {
				const maxIdResult = await queryRows<{
					maxId: number | bigint | null;
				}>(sql`
					SELECT MAX(id) as maxId FROM catalog_items
				`);
				catalogNextId = Number(maxIdResult[0]?.maxId ?? 0) + 1;
			}
		} finally {
			settle();
		}
	}
	catalogIdLastUsed = Date.now();
	const start = catalogNextId;
	catalogNextId += count;
	return Array.from({ length: count }, (_, i) => start + i);
}

/** Test seam: drop the cached id counter between tests. */

/**
 * Read a written offer back and report everything that would keep the hotel from
 * selling it. Best-effort by design: a failed probe must never fail an import
 * that already wrote its files, so this returns no problems on error.
 */
async function catalogOfferProblems(
	catalogItemId: number,
	furniId: number,
): Promise<string[]> {
	try {
		const rows = await queryRows<{
			item_ids: string;
			amount: number;
			cost_credits: number;
			cost_points: number;
			offer_id: number;
			haveOffer: string;
			page_enabled: string;
			page_visible: string;
		}>(sql`
      SELECT ci.item_ids, ci.amount, ci.cost_credits, ci.cost_points, ci.offer_id, ci.haveOffer,
             cp.enabled AS page_enabled, cp.visible AS page_visible
      FROM catalog_items ci
      LEFT JOIN catalog_pages cp ON cp.id = ci.page_id
      WHERE ci.id = ${catalogItemId}
      LIMIT 1
    `);
		const row = rows[0];
		if (!row) return ["catalog entry disappeared right after writing it"];
		return offerPurchasabilityProblems({
			pageEnabled: String(row.page_enabled ?? "0"),
			pageVisible: String(row.page_visible ?? "0"),
			itemIds: String(row.item_ids ?? ""),
			amount: Number(row.amount),
			costCredits: Number(row.cost_credits),
			costPoints: Number(row.cost_points),
			offerId: Number(row.offer_id),
			haveOffer: String(row.haveOffer ?? "0"),
			furniId,
		});
	} catch (error) {
		logger.warn("[import-furni] Cannot verify the imported offer", {
			error: (error as Error).message,
			catalogItemId,
		});
		return [];
	}
}

export async function importSingleFurni(params: {
	id: number;
	classname: string;
	name: string;
	description: string;
	type: string;
	revision: number;
	category: string;
	skipFurniDataWrite?: boolean;
	updateExisting?: boolean;
	repairExisting?: boolean;
	preserveAssets?: boolean;
	/** Validated matching bundle supplied by a queued import. */
	providedNitro?: Buffer;
	onProgress?: (status: string) => void | Promise<void>;
	resolveMissingNitro?: (revision: number) => Promise<Buffer | undefined>;
	/** Per-source SWF download base URL (e.g. "https://virtualc.nl/dcr"). */
	sourceSwfBaseUrl?: string;
	/** Per-source nitro bundle + icon base URL. */
	nitroBaseUrl?: string;
	iconBaseUrl?: string;
}): Promise<ImportSingleResult> {
	const {
		id: originalId,
		name,
		description,
		type,
		revision,
		category,
		skipFurniDataWrite,
		updateExisting,
		repairExisting,
		onProgress,
		sourceSwfBaseUrl,
		nitroBaseUrl: sourceNitroBaseUrl,
		iconBaseUrl: sourceIconBaseUrl,
	} = params;
	const warnings: string[] = [];

	// A classname becomes a file name below (swf/nitro/icon). It travels from a
	// request body into `path.join`, so it must never be able to contain a path
	// separator — otherwise a crafted value escapes the asset directories.
	const classname = params.classname.trim();
	if (!isSafeAssetName(classname)) {
		throw new Error(
			`Invalid furniture classname: ${JSON.stringify(params.classname)}`,
		);
	}

	// Check if already exists by classname OR by spriteId (primary key collision).
	const [existsByName] = await db
		.select({
			id: ItemsBase.id,
			spriteId: ItemsBase.spriteId,
			type: ItemsBase.type,
		})
		.from(ItemsBase)
		.where(eq(ItemsBase.itemName, classname))
		.limit(1);
	if (existsByName && !updateExisting && !repairExisting) {
		return {
			ok: false,
			warnings,
			error: `Item "${classname}" already exists (id: ${existsByName.id})`,
		};
	}
	if (existsByName && existsByName.id !== originalId && !repairExisting) {
		// The classname already occupies a different spriteId. Reassigning the
		// id would orphan every reference (catalog item_ids, player items,
		// furnidata), so this can never be an "update".
		return {
			ok: false,
			warnings,
			error: `Item "${classname}" already exists with id ${existsByName.id} — cannot reassign to spriteId ${originalId}`,
		};
	}
	let itemId = repairExisting && existsByName ? existsByName.id : originalId;
	let spriteId =
		repairExisting && existsByName ? existsByName.spriteId : originalId;
	const preservingExisting = !!(repairExisting && existsByName);
	const [existsById] = await db
		.select({ itemName: ItemsBase.itemName })
		.from(ItemsBase)
		.where(eq(ItemsBase.id, itemId))
		.limit(1);
	if (existsByName && existsById && existsById.itemName !== classname) {
		// The spriteId is owned by a different classname. Even with
		// updateExisting this is a genuine conflict, not an update.
		return {
			ok: false,
			warnings,
			error: `spriteId ${originalId} already used by "${existsById.itemName}"`,
		};
	}

	const isUpdate = !!existsByName;

	// ── Check if spriteId already used in FurnitureData.json ──
	const takenBy = await findFurniDataIdConflict(spriteId, classname);
	if (takenBy && isUpdate) {
		return {
			ok: false,
			warnings,
			error: `spriteId ${spriteId} already used by "${takenBy}" in FurnitureData.json`,
		};
	}

	const itemType = preservingExisting
		? existsByName.type
		: type === "wallitem"
			? "i"
			: "s";

	// ── Cross-reference with configured official Habbo furnidata ──────
	let officialHabbo: OfficialHabboFurniEntry | null = null;
	try {
		const hotel = await getHabboGamedataHotel();
		officialHabbo = await lookupOfficialHabboFurni(classname);
		if (officialHabbo) {
			warnings.push(officialHabboEnrichmentWarning(hotel, officialHabbo.name));
		}
	} catch {
		// Non-blocking: official Habbo enrichment is optional
	}

	// Best values: use configured official Habbo furnidata for enrichment.
	const bestName = name || officialHabbo?.name || classname;
	const bestDescription = description || officialHabbo?.description || "";
	const bestRevision = revision || officialHabbo?.revision || 0;
	const bestCategory = category || officialHabbo?.category || "unknown";

	// ── Derive file-safe names ────────────────────────────────────────
	const rev = bestRevision;
	const assetTargets = await getFurniAssetWriteTargets();
	const { swfDir, iconDir, nitroDir } = assetTargets;
	const starIdx = classname.indexOf("*");
	const hasColor = starIdx !== -1;
	const baseClassname = hasColor ? classname.substring(0, starIdx) : classname;
	const iconFileName = classname.replace(/\*/g, "_");
	const safeSwfName = baseClassname;
	const safeNitroName = baseClassname;
	const swfPath = getRuntimePath(
		/*turbopackIgnore: true*/ swfDir,
		`${safeSwfName}.swf`,
	);
	// Imports write `.hab`; a pre-existing legacy `.nitro` for the same
	// classname still counts as "already present" so a colour variant sharing a
	// base classname never overwrites a bundle that is already on disk.
	const nitroPath = bundleWritePathInDir(
		/*turbopackIgnore: true*/ nitroDir,
		safeNitroName,
	);
	const nitroExists = () =>
		bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, safeNitroName);
	const resolveNitro = () =>
		resolveBundleInDir(/*turbopackIgnore: true*/ nitroDir, safeNitroName);
	const iconPath = getRuntimePath(
		/*turbopackIgnore: true*/ iconDir,
		`${iconFileName}_icon.png`,
	);
	const mirrorSwfDirs = assetTargets.mirrorDirs.map((d) => d.swfDir);
	const mirrorIconDirs = assetTargets.mirrorDirs.map((d) => d.iconDir);
	const mirrorNitroDirs = assetTargets.mirrorDirs.map((d) => d.nitroDir);

	if (params.providedNitro && !nitroExists()) {
		await fs.writeFile(
			nitroPath,
			await toWebpLosslessOrKeep(params.providedNitro, warnings),
			{ flag: "wx" },
		);
	}

	// ── Download assets in parallel (with retry + validation) ────────
	// Icon strategy matches Nitro's URL template:
	//   `${hof.furni.url}/icons/%libname%%param%_icon.png`
	// For color variants (classname has `*`): try color-specific first,
	// fall back to base-classname icon (Nitro reuses base for all colors
	// when no color-specific icon exists).
	await onProgress?.("downloading");

	const iconColorAware = classname.replace(/\*/g, "_");

	// Build candidate URL lists — source-specific URLs first, then Habbo CDN fallback
	const iconUrls: string[] = [];
	const swfUrls: string[] = [];

	// Source-specific icon URLs
	if (sourceIconBaseUrl) {
		// e.g. https://habblet.city/nitro/icons/{classname}_icon.png
		iconUrls.push(
			`${sourceIconBaseUrl}/${encodeURIComponent(iconColorAware)}_icon.png`,
			`${sourceIconBaseUrl}/${encodeURIComponent(baseClassname)}_icon.png`,
		);
	}

	// Source-specific SWF URLs
	if (sourceSwfBaseUrl) {
		// e.g. https://virtualc.nl/dcr/hof_furni/{rev}/{classname}.swf
		swfUrls.push(
			`${sourceSwfBaseUrl}/hof_furni/${rev}/${encodeURIComponent(safeSwfName)}.swf`,
		);
		// Some retros (e.g. Leet, Habboon) serve SWFs without a revision
		// segment: /hof_furni/{classname}.swf
		swfUrls.push(
			`${sourceSwfBaseUrl}/hof_furni/${encodeURIComponent(safeSwfName)}.swf`,
		);
	}

	// Official Habbo CDN fallbacks
	iconUrls.push(
		`https://images.habbo.com/dcr/hof_furni/${rev}/${encodeURIComponent(iconColorAware)}_icon.png`,
		`https://images.habbo.com/dcr/hof_furni/${rev}/${encodeURIComponent(baseClassname)}_icon.png`,
	);
	swfUrls.push(
		`https://images.habbo.com/dcr/hof_furni/${rev}/${encodeURIComponent(safeSwfName)}.swf`,
	);

	// Download icon + SWF concurrently (independent assets). Each tries its
	// candidate URLs in order until one succeeds.
	let iconFailure = "",
		swfFailure = "";
	const [iconOkResult, swfOk] = await Promise.all([
		(preservingExisting || params.preserveAssets) && existsSync(iconPath)
			? Promise.resolve(true)
			: tryDownloadCandidates(iconUrls, iconPath, "png", (detail) => {
					iconFailure = detail;
					warnings.push(`Icon download failed: ${detail}`);
				}),
		// Skip the SWF download entirely when a .nitro bundle already exists on
		// disk — this happens for colour variants that share the base classname's
		// nitro file. The SWF is only used for Nitro conversion (not needed) and
		// icon extraction (the nitro bundle is used as a fallback for that below).
		nitroExists() ||
		params.providedNitro ||
		(params.preserveAssets && nitroExists())
			? Promise.resolve(false)
			: (preservingExisting || params.preserveAssets) && existsSync(swfPath)
				? Promise.resolve(true)
				: tryDownloadCandidates(swfUrls, swfPath, "swf", (detail) => {
						swfFailure = detail;
						warnings.push(`SWF download failed: ${detail}`);
					}),
	]);
	let iconOk = iconOkResult;

	// ── Nitro bundle fallback: try downloading pre-made .nitro ────────
	// Only relevant when the SWF download failed, so it runs after SWF.
	let nitroDownloadOk = false;
	if (!swfOk && sourceNitroBaseUrl && !nitroExists()) {
		const nitroUrl = `${sourceNitroBaseUrl}/${encodeURIComponent(safeNitroName)}.nitro`;
		const dl = await downloadFile(nitroUrl, nitroPath, { validate: "nitro" });
		if (dl.ok) nitroDownloadOk = true;
		else
			warnings.push(
				`Nitro download failed: ${diagnosticAssetUrl(nitroUrl)}: ${dl.error ?? "unknown cause"}`,
			);
	}

	// ── Icon fallback: extract from SWF if download failed ────────────
	if (!iconOk && (swfOk || existsSync(/*turbopackIgnore: true*/ swfPath))) {
		try {
			const swfBuf = await fs.readFile(/*turbopackIgnore: true*/ swfPath);
			const iconPng = await extractIconFromSwfAsync(swfBuf, baseClassname);
			if (iconPng) {
				await fs.writeFile(/*turbopackIgnore: true*/ iconPath, iconPng);
				iconOk = true;
				warnings.push("Icon extracted from SWF (download failed)");
			} else {
				warnings.push(
					"Icon download failed and SWF icon extraction returned nothing",
				);
			}
		} catch {
			warnings.push("Icon download failed and SWF icon extraction also failed");
		}
	} else if (!iconOk) {
		warnings.push(
			`Icon image download failed: ${iconFailure || "unknown cause"}`,
		);
	}

	if (
		!swfOk &&
		!nitroDownloadOk &&
		!params.providedNitro &&
		!nitroExists() &&
		!(params.preserveAssets && nitroExists())
	)
		warnings.push(`SWF download failed: ${swfFailure || "unknown cause"}`);

	// ── Convert SWF to Nitro ──────────────────────────────────────────
	await onProgress?.("converting");
	let conversionResult: ConversionResult | null = null;

	if (nitroExists()) {
		warnings.push("Bundle file already exists (shared across color variants)");
	} else {
		try {
			if (existsSync(/*turbopackIgnore: true*/ swfPath)) {
				const swfBuffer = await fs.readFile(/*turbopackIgnore: true*/ swfPath);
				conversionResult = await convertSwfToNitroAsync(
					swfBuffer,
					baseClassname,
				);
				await fs.writeFile(
					/*turbopackIgnore: true*/ nitroPath,
					conversionResult.bundle,
				);
				if (conversionResult.warnings.length > 0) {
					warnings.push(...conversionResult.warnings);
				}
			} else {
				warnings.push("SWF not available for Nitro conversion");
			}
		} catch (err) {
			logger.warn("[import-furni] SWF to Nitro conversion failed", {
				error: (err as Error).message,
			});
			warnings.push(
				`SWF to Nitro conversion failed: ${(err as Error).message}`,
			);
		}
	}

	if (!nitroExists() && params.resolveMissingNitro) {
		await onProgress?.("checking_sources");
		const recovered = await params.resolveMissingNitro(rev);
		if (recovered)
			await fs.writeFile(
				nitroPath,
				await toWebpLosslessOrKeep(recovered, warnings),
				{ flag: "wx" },
			);
		else
			warnings.push(
				"No matching bundle was recovered from the checked sources. Review source availability or attach the original .nitro file.",
			);
	}

	if (!iconOk && nitroExists()) {
		try {
			const icon = await extractFurniIconPng(
				await fs.readFile(resolveNitro() ?? nitroPath),
			);
			if (icon) {
				await fs.writeFile(iconPath, icon);
				iconOk = true;
				warnings.push("Icon extracted from Nitro bundle");
			}
		} catch {
			warnings.push("Could not extract an icon from the Nitro bundle");
		}
	}

	// ── Rollback: if conversion/download failed AND no .nitro exists, remove DB record ──
	// Also validate that the .nitro file is non-trivial (≥ 128 bytes — a bare
	// Nitro bundle header is larger than that, anything smaller is corrupt/empty).
	const nitroStat = await fs
		.stat(resolveNitro() ?? nitroPath)
		.catch(() => null);
	const nitroValid = nitroStat && nitroStat.size >= 128;

	if (!nitroValid) {
		if (nitroStat) {
			warnings.push(
				`Nitro file too small/corrupt (${nitroStat.size} bytes) — removing`,
			);
			try {
				await fs.unlink(resolveNitro() ?? nitroPath);
			} catch {
				/* ignore */
			}
		}

		return {
			ok: false,
			warnings,
			error: `${isUpdate ? "No .nitro file could be created; existing furniture was preserved" : "Import not started: no .nitro file could be created"} (${classname}, revision ${rev}). ${warnings
				.filter((warning) => /conversion|download|SWF/.test(warning))
				.slice(-3)
				.join(". ")}`,
		};
	}

	// ── Insert into DB with enriched data ──────────────────────────────
	await onProgress?.("writing_db");
	try {
		if (preservingExisting) {
			warnings.push(
				`Existing furniture #${itemId}: SQL settings and catalog offers preserved`,
			);
		} else if (isUpdate) {
			// NOTE: live Arcturus `items_base` has no description/revision/rare columns —
			// those metadata fields are persisted in FurnitureData.json (see entry below),
			// not in the DB. Only refresh the columns this import manages.
			await db.execute(sql`
        UPDATE items_base SET sprite_id = ${spriteId}, public_name = ${bestName}, item_name = ${classname}, type = ${itemType}
        WHERE id = ${spriteId}
      `);
		} else {
			itemId = await reserveFurnitureId(
				originalId,
				classname,
				async (allocatedId) => {
					await db.execute(
						sql`INSERT INTO items_base (id, sprite_id, public_name, item_name, type) VALUES (${allocatedId}, ${allocatedId}, ${bestName}, ${classname}, ${itemType})`,
					);
				},
			);
			spriteId = itemId;
			if (spriteId !== originalId)
				warnings.push(
					`Source ID ${originalId} is occupied; imported with local ID ${spriteId}`,
				);
		}
	} catch (err) {
		return {
			ok: false,
			warnings,
			error: `DB ${isUpdate ? "update" : "insert"} failed: ${(err as Error).message}`,
		};
	}

	await Promise.all([
		mirrorFileToDirs(swfPath, `${safeSwfName}.swf`, mirrorSwfDirs, warnings),
		mirrorFileToDirs(
			iconPath,
			`${iconFileName}_icon.png`,
			mirrorIconDirs,
			warnings,
		),
		mirrorFileToDirs(
			resolveNitro() ?? nitroPath,
			`${safeNitroName}${LOCAL_BUNDLE_EXT}`,
			mirrorNitroDirs,
			warnings,
		),
	]);

	// ── Build enriched FurnitureData entry ────────────────────────────
	const dims =
		conversionResult?.dimensions ||
		(officialHabbo
			? { x: officialHabbo.xdim, y: officialHabbo.ydim, z: 0 }
			: { x: 1, y: 1, z: 0 });
	const meta = conversionResult?.metadata ?? null;

	// Real sit/lay/stand flags: prefer .nitro logic flags, then the configured
	// official Habbo furnidata. Only pass them when a real source exists —
	// defaulted all-false values must not suppress keyword detection (custom
	// SWFs often ship without <action> nodes even for sittable furniture).
	const realSource = meta ?? officialHabbo;
	const realFlags = realSource
		? {
				cansiton: realSource.cansiton ?? false,
				canlayon: realSource.canlayon ?? false,
				canstandon: realSource.canstandon ?? false,
				// Official furnidata is curated → authoritative. SWF-derived flags
				// are only authoritative when the logic actually had <action> nodes.
				hasActionData: meta ? (meta.hasActions ?? true) : true,
			}
		: undefined;

	// Derive interaction_type. Priority:
	//   1. Wired LOGIC items (wf_act_/wf_trg_/wf_cnd_/wf_slc_/wf_xtra_/wf_var_)
	//      — use the FULL classname so Arcturus can route to the specific
	//      InteractionWired* handler. Collapsing to wf_act/wf_trg/wf_cnd
	//      breaks every wired because the emulator looks up the exact type.
	//   2. .nitro logicType match for known mechanics.
	//   3. Non-logic wired (wf_firegate, wf_pressureplate, wf_pyramid,
	//      wf_floor_switch, …) that didn't match step 2 — use the full
	//      classname as a safe fallback instead of 'default'.
	//   4. Final fallback: default.
	const logicType = meta?.logicType || "";
	let interactionType = "default";
	if (/^wf_(act|trg|cnd|slc|xtra|var)_/.test(classname)) {
		interactionType = classname;
	} else if (logicType.includes("multistate")) interactionType = "default";
	else if (logicType.includes("gate")) interactionType = "gate";
	else if (logicType.includes("teleport")) interactionType = "teleport";
	else if (logicType.includes("roller")) interactionType = "roller";
	else if (logicType.includes("dice")) interactionType = "dice";
	else if (logicType.includes("vendingmachine"))
		interactionType = "vendingmachine";
	else if (logicType.includes("firework")) interactionType = "fireworks";
	else if (logicType.includes("trophy")) interactionType = "trophy";
	else if (logicType.includes("exchange")) interactionType = "exchange";
	else if (logicType.includes("habbowheel")) interactionType = "habbowheel";
	else if (logicType.includes("soundmachine")) interactionType = "jukebox";
	else if (logicType.includes("badge")) interactionType = "badge";

	if (interactionType === "default" && /^wf_/.test(classname)) {
		interactionType = classname;
		warnings.push(
			`Wired fallback: using full classname "${classname}" as interaction_type`,
		);
	}

	// allow_stack: if it has height and you can put things on it
	const allowStack = dims.z > 0 ? "1" : "0";

	// Auto-detect interaction modes count. Real flags (SWF logic XML /
	// official furnidata) win over keyword guessing — no false positives.
	let nitroJsonForModes: Record<string, unknown> | null = null;
	try {
		const parsed = parseNitroBundle(
			await fs.readFile(resolveNitro() ?? nitroPath),
		);
		nitroJsonForModes = parsed.json as Record<string, unknown>;
	} catch {
		// no bundle JSON available — keyword fallback only
	}
	const autoInteraction = autoDetectInteraction(classname, bestName, {
		...realFlags,
		logicType,
		animationStates: nitroAnimationStatesCount(nitroJsonForModes),
	});
	const interactionModesCount = autoInteraction.interactionModesCount;

	// When the .nitro logicType produced no specific handler, fall back to the
	// auto-detected type (classname mechanic + keyword + real flags) exactly
	// like the post-import verification sweep, so newly imported items carry the
	// correct interaction_type immediately instead of waiting for the sweep.
	// Never applied to updates — existing emulator handler types must survive.
	if (
		!isUpdate &&
		interactionType === "default" &&
		autoInteraction.interactionType !== "default"
	) {
		interactionType = autoInteraction.interactionType;
	}

	// Update items_base with ALL enriched data
	try {
		const update = buildItemsBaseEnrichmentUpdate({
			id: itemId,
			dims,
			cansiton: autoInteraction.canSit,
			canlayon: autoInteraction.canLay,
			canstandon: autoInteraction.canStand,
			allowStack,
			interactionType,
			interactionModesCount,
		});
		if (!preservingExisting) await db.execute(update);
	} catch (err) {
		warnings.push(
			`items_base dimension update failed: ${(err as Error).message}`,
		);
	}

	// Build enriched FurnitureData.json entry using best available data
	const furniEntry = buildFurniEntry({
		id: spriteId,
		classname,
		revision: bestRevision,
		category: bestCategory,
		name: bestName,
		description: bestDescription,
		spriteId,
		dims,
		metadata: meta,
		officialHabbo,
	});

	// ── Add to FurnitureData.json (or defer for batch) ────────────────
	if (skipFurniDataWrite) {
		// Batch mode: return the entry so the caller writes once at the end
	} else {
		try {
			await onProgress?.("writing_furnidata");
			await appendFurniEntry(furniEntry, itemType);
		} catch (err) {
			logger.warn("[import-furni] Failed to update FurnitureData.json", {
				error: (err as Error).message,
			});
			warnings.push("FurnitureData.json update failed");
		}
	}

	// ── Create catalog entry (with duplicate check + category sub-page) ──
	let catalogItemId: number | null = null;
	let catalogUpdated = false;
	try {
		const itemIdStr = String(itemId);

		// Check if this item already exists anywhere in the catalog
		const existingCatalog = await queryRows<{
			id: number;
			page_id: string;
		}>(sql`
      SELECT id, page_id FROM catalog_items WHERE FIND_IN_SET(${itemIdStr}, REPLACE(item_ids, ';', ',')) > 0 LIMIT 1
    `);

		if (existingCatalog.length > 0) {
			catalogItemId = existingCatalog[0].id;
			if (updateExisting && !preservingExisting) {
				// Update existing catalog entry: price, page, etc.
				const categoryPageId = await getOrCreateCategoryPage(
					classname,
					itemType,
				);
				const pageIdStr = String(categoryPageId);
				const price = autoPriceFurni(classname);
				await db.execute(sql`
          UPDATE catalog_items
          SET page_id = ${pageIdStr}, cost_credits = ${price.credits}, cost_points = ${price.points}, points_type = ${price.pointsType}, offer_id = id
          WHERE id = ${catalogItemId}
        `);
				catalogUpdated = true;
				warnings.push(
					`Item updated in catalog (catalog_item #${catalogItemId}, page ${categoryPageId})`,
				);
			} else {
				warnings.push(
					`Item already in catalog (catalog_item #${catalogItemId}, page ${existingCatalog[0].page_id}) — skipped duplicate`,
				);
			}
		} else {
			// Get or create the right category sub-page based on classname
			const categoryPageId = await getOrCreateCategoryPage(classname, itemType);
			const pageIdStr = String(categoryPageId);
			const price = autoPriceFurni(classname);
			catalogItemId = await allocateCatalogItemId(async (nextCatalogId) => {
				await db.execute(sql`
          INSERT INTO catalog_items (id, page_id, item_ids, catalog_name, cost_credits, cost_points, points_type, amount, order_number, offer_id, extradata)
          VALUES (${nextCatalogId}, ${pageIdStr}, ${itemIdStr}, ${classname}, ${price.credits}, ${price.points}, ${price.pointsType}, 1, 1, ${nextCatalogId}, '')
        `);
				return nextCatalogId;
			});
		}
	} catch (err) {
		logger.warn("[import-furni] Failed to create catalog entry", {
			error: (err as Error).message,
		});
		warnings.push("Catalog entry creation failed");
	}

	if (catalogItemId !== null) {
		// The write above is not proof the hotel will sell anything: a hidden or
		// disabled page, an `item_ids` that misses the furni id or a zero amount
		// all import "successfully" and show the player nothing. Read the row back
		// and say so here, where the import report already shows up, instead of
		// letting it surface as "the import did not work" in the client.
		const problems = await catalogOfferProblems(catalogItemId, itemId);
		for (const problem of problems) {
			warnings.push(`Offer not purchasable: ${problem}`);
		}
		if (problems.length > 0) {
			logger.warn("[import-furni] Imported offer is not purchasable", {
				classname,
				catalogItemId,
				problems,
			});
		}
	}

	return {
		ok: true,
		itemId,
		catalogItemId,
		catalogUpdated,
		dimensions: dims,
		spriteCount: conversionResult?.spriteCount,
		warnings,
		furniDataEntry: skipFurniDataWrite
			? { entry: furniEntry, itemType }
			: undefined,
	};
}

// ── Interaction modes count verification ──────────────────────────────

const nitroModesCache = new Map<string, number | undefined>();
const NITRO_MODES_CACHE_TTL_MS = 5 * 60_000;
let nitroModesCacheAt = 0;

async function realNitroModes(classname: string): Promise<number | undefined> {
	if (Date.now() - nitroModesCacheAt > NITRO_MODES_CACHE_TTL_MS) {
		nitroModesCache.clear();
		nitroModesCacheAt = Date.now();
	}
	const base = classname.split("*")[0];
	const cached = nitroModesCache.get(base);
	if (cached !== undefined) return cached;
	try {
		const nitroPath = resolveBundleInDir(
			/*turbopackIgnore: true*/ FURNI_NITRO_DIR,
			base,
		);
		if (!nitroPath) {
			nitroModesCache.set(base, undefined);
			return undefined;
		}
		const parsed = parseNitroBundle(await fs.readFile(nitroPath));
		const modes = nitroAnimationStatesCount(
			parsed.json as Record<string, unknown>,
		);
		nitroModesCache.set(base, modes);
		return modes;
	} catch {
		nitroModesCache.set(base, undefined);
		return undefined;
	}
}

/** Fix database consistency after import:
 *  1. Fill empty catalog_name from items_base.public_name
 *  2. Set have_offer = '1' where it was '0'
 *  3. Set cost_credits = 3 where it was <= 0
 * Returns { catalogNameFixed, haveOfferFixed, costCreditsFixed } with counts. */
export async function fixDatabaseConsistencyAfterImport(): Promise<{
	catalogNameFixed: number;
	haveOfferFixed: number;
	costCreditsFixed: number;
}> {
	// 1. Fill empty catalog_name from items_base.public_name
	const nameResult = await execResult(sql`
    UPDATE catalog_items c
    JOIN items_base i ON c.item_ids = i.id
    SET c.catalog_name = CASE
      WHEN i.public_name LIKE '%*%' THEN SUBSTRING_INDEX(i.public_name, '*', 1)
      ELSE i.public_name
    END
    WHERE c.catalog_name IS NULL OR c.catalog_name = ''
  `);
	const catalogNameFixed = Number(nameResult.affectedRows ?? 0);

	// 2. Set have_offer = '1' where it was '0'
	const offerResult = await execResult(sql`
    UPDATE catalog_items
    SET have_offer = '1'
    WHERE have_offer = '0'
  `);
	const haveOfferFixed = Number(offerResult.affectedRows ?? 0);

	// 3. Set cost_credits = 3 where it was <= 0
	const creditResult = await execResult(sql`
    UPDATE catalog_items
    SET cost_credits = 3
    WHERE cost_credits <= 0
  `);
	const costCreditsFixed = Number(creditResult.affectedRows ?? 0);

	return { catalogNameFixed, haveOfferFixed, costCreditsFixed };
}

/** Verify and fix interaction values for ALL furniture in items_base.
 * Run after import to ensure every item's interaction_type, modes count and
 * sit/lay/stand flags match the real furniture data. Only items with
 * authoritative data (furnidata flags or .nitro animation states) are
 * touched — keyword guesses are never applied here, so there are no false
 * positives. */
export async function verifyAndFixInteractionModesCount(): Promise<{
	fixed: number;
	checked: number;
	skipped: number;
	errors: string[];
}> {
	const errors: string[] = [];
	let fixed = 0;
	let checked = 0;
	let skipped = 0;
	const BATCH_SIZE = 500;

	try {
		let offset = 0;
		while (true) {
			const batch = await db
				.select({
					id: ItemsBase.id,
					itemName: ItemsBase.itemName,
					publicName: ItemsBase.publicName,
					allowSit: ItemsBase.allowSit,
					allowLay: ItemsBase.allowLay,
					allowWalk: ItemsBase.allowWalk,
					interactionType: ItemsBase.interactionType,
					interactionModesCount: ItemsBase.interactionModesCount,
				})
				.from(ItemsBase)
				.limit(BATCH_SIZE)
				.offset(offset);

			if (batch.length === 0) break;
			offset += batch.length;
			checked += batch.length;

			for (const item of batch) {
				const realFlags = await lookupRealFurniFlags(item.itemName);

				if (realFlags.source === "none") {
					skipped++;
					continue;
				}

				const animationModes = await realNitroModes(item.itemName);
				const auto = autoDetectInteraction(item.itemName, item.publicName, {
					cansiton: realFlags.cansiton,
					canlayon: realFlags.canlayon,
					canstandon: realFlags.canstandon,
					hasActionData: true,
					animationStates: animationModes,
				});

				const changes: Partial<Record<string, unknown>> = {};
				if (
					item.allowSit !== 2 &&
					(item.allowSit ? 1 : 0) !== (auto.canSit ? 1 : 0)
				)
					changes.allowSit = auto.canSit ? 1 : 0;
				if (
					item.allowLay !== 2 &&
					(item.allowLay ? 1 : 0) !== (auto.canLay ? 1 : 0)
				)
					changes.allowLay = auto.canLay ? 1 : 0;
				if (
					item.allowWalk !== 2 &&
					(item.allowWalk ? 1 : 0) !== (auto.canStand ? 1 : 0)
				)
					changes.allowWalk = auto.canStand ? 1 : 0;
				if ((item.interactionModesCount ?? 0) !== auto.interactionModesCount)
					changes.interactionModesCount = auto.interactionModesCount;
				if (
					(item.interactionType === "default" || !item.interactionType) &&
					auto.interactionType !== "default"
				) {
					changes.interactionType = auto.interactionType;
				}

				if (Object.keys(changes).length > 0) {
					try {
						await db
							.update(ItemsBase)
							.set(changes)
							.where(eq(ItemsBase.id, item.id));
						fixed++;
					} catch (err) {
						errors.push(
							`Failed to fix ${item.itemName}: ${(err as Error).message}`,
						);
					}
				}
			}
		}
	} catch (err) {
		errors.push(`Verification failed: ${(err as Error).message}`);
	}

	return { fixed, checked, skipped, errors };
}

// ── Delete helpers ───────────────────────────────────────────────────

/** Delete a single imported item: DB records, FurnitureData.json entry, and asset files. */
export async function deleteImportedItem(classname: string): Promise<{
	spriteId: number;
	deletedFiles: string[];
	errors: string[];
}> {
	const errors: string[] = [];

	// Look up item in DB
	const [item] = await db
		.select({ id: ItemsBase.id, type: ItemsBase.type })
		.from(ItemsBase)
		.where(eq(ItemsBase.itemName, classname))
		.limit(1);

	if (!item) {
		throw new Error(`Item "${classname}" not found in database`);
	}

	const spriteId = item.id;
	const starIdx = classname.indexOf("*");
	const assetTargets = await getFurniAssetWriteTargets();
	const { swfDir, iconDir, nitroDir } = assetTargets;
	const baseClassname =
		starIdx !== -1 ? classname.substring(0, starIdx) : classname;
	const iconFileName = classname.replace(/\*/g, "_");

	// 1. Delete catalog_items — match by the canonical item_ids link only.
	//    catalog_name may have been translated to a public name, so adding a
	//    name condition would silently leave an orphaned catalog row behind.
	try {
		const itemIdStr = String(spriteId);
		await db.execute(
			sql`DELETE FROM catalog_items WHERE item_ids = ${itemIdStr}`,
		);
	} catch (err) {
		errors.push(`catalog_items: ${(err as Error).message}`);
	}

	// 2. Delete items_base
	try {
		await db.execute(
			sql`DELETE FROM items_base WHERE id = ${spriteId} AND item_name = ${classname}`,
		);
	} catch (err) {
		errors.push(`items_base: ${(err as Error).message}`);
	}

	// 3. Remove from FurnitureData.json
	try {
		await removeFurniEntry(classname);
	} catch (err) {
		errors.push(`FurnitureData.json: ${(err as Error).message}`);
	}

	// 4. Delete files (bundle — `.hab` and any legacy `.nitro` — plus .swf, icon)
	const filesToDelete = [
		...[nitroDir, ...assetTargets.mirrorDirs.map((d) => d.nitroDir)].flatMap(
			(dir) =>
				bundleFileNames(baseClassname).map((name) =>
					getRuntimePath(/*turbopackIgnore: true*/ dir, name),
				),
		),
		getRuntimePath(/*turbopackIgnore: true*/ swfDir, `${baseClassname}.swf`),
		getRuntimePath(
			/*turbopackIgnore: true*/ iconDir,
			`${iconFileName}_icon.png`,
		),
		...assetTargets.mirrorDirs.flatMap((dirs) => [
			getRuntimePath(
				/*turbopackIgnore: true*/ dirs.swfDir,
				`${baseClassname}.swf`,
			),
			getRuntimePath(
				/*turbopackIgnore: true*/ dirs.iconDir,
				`${iconFileName}_icon.png`,
			),
		]),
	];

	const deletedFiles: string[] = [];
	for (const filePath of filesToDelete) {
		if (existsSync(/*turbopackIgnore: true*/ filePath)) {
			try {
				await fs.unlink(/*turbopackIgnore: true*/ filePath);
				deletedFiles.push(path.basename(filePath));
			} catch (err) {
				errors.push(`${path.basename(filePath)}: ${(err as Error).message}`);
			}
		}
	}

	return { spriteId, deletedFiles, errors };
}

/** Clean up SWF files that have already been converted to Nitro. */
export async function cleanupConvertedSwfs(): Promise<{
	deleted: number;
	total: number;
	remaining: number;
	errors: string[];
}> {
	const { swfDir, nitroDir } = await getFurniAssetDirs();
	if (!existsSync(swfDir)) {
		return { deleted: 0, total: 0, remaining: 0, errors: [] };
	}

	const swfFiles = (await fs.readdir(swfDir)).filter((f) => f.endsWith(".swf"));
	let deleted = 0;
	const errors: string[] = [];

	for (const swfFile of swfFiles) {
		const cn = swfFile.replace(".swf", "");

		if (bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, cn)) {
			try {
				await fs.unlink(
					getRuntimePath(/*turbopackIgnore: true*/ swfDir, swfFile),
				);
				deleted++;
			} catch (err) {
				errors.push(`Failed to delete ${swfFile}: ${(err as Error).message}`);
			}
		}
	}

	return {
		deleted,
		total: swfFiles.length,
		remaining: swfFiles.length - deleted,
		errors,
	};
}

/** Rollback a furni import by import log ID. Returns { ok, rolledBack: number, errors: string[] }. */
