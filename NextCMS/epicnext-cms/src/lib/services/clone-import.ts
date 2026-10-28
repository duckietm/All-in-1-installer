import { promises as fs } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { autoDetectInteraction } from "@/lib/furni/auto-interaction";
import { bundleWritePathInDir } from "@/lib/furni/bundle-file";
import { normalizeClassname } from "@/lib/furni/classname";
import { HABBO_GAMEDATA_HOTEL_SETTING_KEY } from "@/lib/habbo-gamedata-hotel";
import { logger } from "@/lib/logger";
import { fetchWithByparr } from "@/lib/services/byparr";
import { extractFurniIconPng } from "@/lib/services/clone-icon";
import type { CloneSource } from "@/lib/services/clone-sources";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import { appendFurniEntry } from "@/lib/services/furni-data";
import {
	allocateCatalogItemId,
	autoPriceFurni,
	ensureDirectories,
	getOrCreateCategoryPage,
} from "@/lib/services/furni-import";
import { nitroAnimationStatesCount } from "@/lib/services/furni-real-interaction";
import { browserHeaders } from "@/lib/services/import/core/browser-headers";
import {
	curlDownload,
	curlFetchText,
} from "@/lib/services/import/core/curl-fetch";
import { downloadFile } from "@/lib/services/import/core/download";
import { siteSettings } from "@/lib/services/site-settings";
import {
	parseNitroBundle,
	toWebpLosslessBundle,
} from "@/lib/services/swf/nitro-builder";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export interface SourceFurni {
	id: number;
	classname: string;
	name: string;
	description: string;
	xdim: number;
	ydim: number;
	canstandon: boolean;
	cansiton: boolean;
	canlayon: boolean;
	customparams: string;
	itemType: "s" | "i";
	[k: string]: unknown;
}

export interface CloneResult {
	ok: boolean;
	classname: string;
	skipped?: boolean;
	warnings: string[];
	error?: string;
	/** Set when `deferFurniData` is used so the caller can batch-write once. */
	furniDataEntry?: { entry: Record<string, unknown>; itemType: string };
}

interface FurniType {
	furnitype?: Array<Record<string, unknown>>;
}
interface RemoteFurnidata {
	roomitemtypes?: FurniType;
	wallitemtypes?: FurniType;
	furnitype?: Array<Record<string, unknown>>;
}

// Spread ...raw first so the coerced typed fields always win over raw values.
function toSourceFurni(
	raw: Record<string, unknown>,
	itemType: "s" | "i",
): SourceFurni {
	return {
		...raw,
		id: Number(raw.id ?? 0),
		revision:
			Number.isSafeInteger(Number(raw.revision)) && Number(raw.revision) > 0
				? Number(raw.revision)
				: 0,
		classname: String(raw.classname ?? ""),
		name: String(raw.name ?? raw.classname ?? ""),
		description: String(raw.description ?? ""),
		xdim: Number(raw.xdim ?? 1),
		ydim: Number(raw.ydim ?? 1),
		canstandon: raw.canstandon === true,
		cansiton: raw.cansiton === true,
		canlayon: raw.canlayon === true,
		customparams: String(raw.customparams ?? ""),
		itemType,
	};
}

export function parseFurnidata(data: RemoteFurnidata): SourceFurni[] {
	const out: SourceFurni[] = [];
	for (const r of data.roomitemtypes?.furnitype ?? data.furnitype ?? [])
		out.push(toSourceFurni(r, "s"));
	for (const r of data.wallitemtypes?.furnitype ?? [])
		out.push(toSourceFurni(r, "i"));
	return out.filter((e) => e.classname);
}

const cache = new Map<string, { list: SourceFurni[]; ts: number }>();
const TTL = 5 * 60 * 1000;

/**
 * Some sources serve their furnidata wrapped in an HTML document (e.g. Leet's
 * JSON is embedded in a `<pre>` block inside the page, often surfaced by the
 * Byparr fallback). Extract the JSON payload before giving up.
 */
function extractJsonFromHtml(body: string): string | null {
	const pre = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
	const candidate = pre?.[1] ?? body;
	const trimmed = candidate.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		JSON.parse(trimmed);
		return trimmed;
	} catch {
		return null;
	}
}

/**
 * Fetch a source's furnidata via Byparr, falling back to a curl
 * subprocess. Some CDNs (e.g. Leet.city) block Node's TLS fingerprint while
 * the same request succeeds from curl — so curl is a useful second fallback
 * when Byparr is unavailable.
 */
async function fetchWithFallback(url: string): Promise<string> {
	try {
		return await fetchWithByparr(url);
	} catch {
		try {
			return await curlFetchText(url);
		} catch (err) {
			throw new Error(
				`Byparr + curl fallback failed for ${url}: ${(err as Error).message}`,
			);
		}
	}
}

export async function fetchSourceFurnidata(
	url: string,
	now = Date.now(),
): Promise<SourceFurni[]> {
	const hit = cache.get(url);
	if (hit && now && now - hit.ts < TTL) return hit.list;
	let body: string;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(30000),
			headers: browserHeaders(),
		});
		if (res.ok) {
			// Some sources (e.g. GitHub raw) serve JSON with a text/plain
			// content-type — only route to Byparr when the body is actually
			// HTML, otherwise parse the JSON directly.
			const text = await res.text();
			if (
				text.trimStart().startsWith("{") ||
				text.trimStart().startsWith("[")
			) {
				body = text;
			} else {
				body = await fetchWithFallback(url);
			}
		} else {
			body = await fetchWithFallback(url);
		}
	} catch {
		body = await fetchWithFallback(url);
	}
	if (body.trimStart().startsWith("<")) {
		const extracted = extractJsonFromHtml(body);
		if (!extracted) {
			throw new Error(
				`Source ${url} is behind a Cloudflare challenge that could not be bypassed. Start Byparr and check its logs.`,
			);
		}
		body = extracted;
	}
	let list: SourceFurni[];
	try {
		const json = JSON.parse(body);
		list = parseFurnidata(json);
	} catch (err) {
		throw new Error(
			`furnidata parse failed for ${url}: ${(err as Error).message}`,
		);
	}
	cache.set(url, { list, ts: now });
	return list;
}

/**
 * Allocate the next `items_base.id` through a process-level async mutex so
 * concurrent clones in the same Node process cannot race on MAX(id)+1.
 * Mirrors the `allocateCatalogItemId` pattern from furni-import.ts.
 */
let itemsBaseNextId: number | null = null;
let itemsBaseIdLastUsed = 0;
let itemsBaseIdSeedChain: Promise<void> = Promise.resolve();
const ITEMS_BASE_ID_REFRESH_MS = 60_000;

/** Allocate a unique items_base id. Seeded once with MAX(id)+1, then handed
 *  out from an in-process counter so concurrent clones don't serialize on a
 *  SELECT MAX + INSERT round-trip per item. Re-seeds when idle for a while so
 *  rows added by the emulator or other processes don't collide. */
async function allocateItemsBaseId<T>(
	insertFn: (nextId: number) => Promise<T>,
): Promise<T> {
	const now = Date.now();
	if (
		itemsBaseNextId === null ||
		now - itemsBaseIdLastUsed > ITEMS_BASE_ID_REFRESH_MS
	) {
		let settle!: () => void;
		const prev = itemsBaseIdSeedChain;
		itemsBaseIdSeedChain = new Promise<void>((r) => {
			settle = r;
		});
		await prev.catch(() => {});
		try {
			if (
				itemsBaseNextId === null ||
				Date.now() - itemsBaseIdLastUsed > ITEMS_BASE_ID_REFRESH_MS
			) {
				const idRows = await queryRows<{ next: number }>(sql`
					SELECT COALESCE(MAX(id), 0) + 1 AS next FROM items_base
				`);
				itemsBaseNextId = Number(idRows[0]?.next ?? 1);
			}
		} finally {
			settle();
		}
	}
	itemsBaseIdLastUsed = Date.now();
	const nextId = itemsBaseNextId;
	itemsBaseNextId += 1;
	return await insertFn(nextId);
}

/** Test seam: drop the cached id counter between tests. */
export function __resetItemsBaseAllocatorForTests(): void {
	itemsBaseNextId = null;
	itemsBaseIdLastUsed = 0;
	itemsBaseIdSeedChain = Promise.resolve();
}

export async function cloneSingleFurni(params: {
	source: CloneSource;
	entry: SourceFurni;
	onProgress?: (status: string) => void | Promise<void>;
	/** Skip the per-item FurnitureData.json write and return the entry instead,
	 *  so batch callers can append everything in one lock + write cycle. */
	deferFurniData?: boolean;
}): Promise<CloneResult> {
	const { source, entry, onProgress, deferFurniData } = params;
	const { classname, itemType } = entry;
	const warnings: string[] = [];

	// Set the active Habbo hotel for official furnidata enrichment.
	if (source.hotel) {
		try {
			await siteSettings.update(HABBO_GAMEDATA_HOTEL_SETTING_KEY, source.hotel);
		} catch {
			/* non-blocking */
		}
	}

	// Path-traversal guard: classname comes from remote furnidata and is used to
	// build file paths — reject anything that doesn't look like a safe furni name.
	if (!/^[\w\-.*]+$/.test(classname)) {
		return { ok: false, classname, warnings, error: "invalid classname" };
	}

	// Dedup by classname.
	const existing = await db
		.select({ id: ItemsBase.id })
		.from(ItemsBase)
		.where(eq(ItemsBase.itemName, classname))
		.limit(1);
	if (existing.length > 0) {
		return {
			ok: false,
			classname,
			skipped: true,
			warnings,
			error: "Already present",
		};
	}

	await ensureDirectories();
	const { iconDir, nitroDir } = await getFurniAssetDirs();

	// Download the bundle + icon directly from the source hotel. Sources serve
	// `.nitro`; the local copy is stored as `.hab`.
	await onProgress?.("downloading");
	const nitroPath = bundleWritePathInDir(
		/*turbopackIgnore: true*/ nitroDir,
		classname,
	);
	const iconPath = getRuntimePath(
		/*turbopackIgnore: true*/ iconDir,
		`${classname}_icon.png`,
	);
	const dl = await downloadFile(
		`${source.nitroBaseUrl}/${classname}.nitro`,
		nitroPath,
		{
			maxRetries: 2,
		},
	);
	if (!dl.ok) {
		// Node's fetch may be TLS-fingerprint-blocked by the source CDN
		// (e.g. Leet.city) while curl still succeeds — try that before giving up.
		const curlDl = await curlDownload(
			`${source.nitroBaseUrl}/${classname}.nitro`,
			nitroPath,
		);
		if (!curlDl.ok) {
			logger.warn("[clone-import] nitro download failed for", { classname });
			return { ok: false, classname, warnings, error: "nitro download failed" };
		}
	}
	// Validate it is a real Nitro bundle.
	let clonedNitroJson: Record<string, unknown> | null = null;
	try {
		const parsed = parseNitroBundle(
			await fs.readFile(/*turbopackIgnore: true*/ nitroPath),
		);
		clonedNitroJson = parsed.json as Record<string, unknown>;
	} catch {
		await fs.unlink(/*turbopackIgnore: true*/ nitroPath).catch(() => {});
		logger.warn("[clone-import] invalid bundle for", { classname });
		return { ok: false, classname, warnings, error: "invalid bundle" };
	}
	// Hotels ship PNG textures, so normalise every clone to WebP Lossless and
	// make it match the SWF importer. A texture that will not re-encode is
	// kept as it arrived rather than failing the whole import — the bundle is
	// valid, and losing the furniture over a codec edge case is worse.
	try {
		const converted = await toWebpLosslessBundle(
			await fs.readFile(/*turbopackIgnore: true*/ nitroPath),
		);
		await fs.writeFile(/*turbopackIgnore: true*/ nitroPath, converted);
	} catch (err) {
		warnings.push("texture kept in its original format");
		logger.warn("[clone-import] WebP normalisation failed for", {
			classname,
			err,
		});
	}
	let iconDl: { ok: boolean; size: number };
	if (source.iconBaseUrl) {
		iconDl = await downloadFile(
			`${source.iconBaseUrl}/${classname}_icon.png`,
			iconPath,
			{
				maxRetries: 1,
				validate: "png",
			},
		);
		if (!iconDl.ok) {
			// Same TLS-fingerprint fallback as the nitro download.
			iconDl = await curlDownload(
				`${source.iconBaseUrl}/${classname}_icon.png`,
				iconPath,
			);
		}
	} else {
		// No standalone icons on this source (e.g. Habbo/Hubba) — fall through to
		// extracting the catalog icon from the .nitro bundle we just downloaded.
		iconDl = { ok: false, size: 0 };
	}
	if (!iconDl.ok) {
		// Source serves no standalone icon (e.g. icons embedded in the .nitro) —
		// extract the catalog icon from the bundle we just downloaded.
		try {
			const icon = await extractFurniIconPng(
				await fs.readFile(/*turbopackIgnore: true*/ nitroPath),
			);
			if (icon) {
				await fs.writeFile(/*turbopackIgnore: true*/ iconPath, icon);
			} else {
				warnings.push("no icon (not in source or bundle)");
			}
		} catch {
			warnings.push("icon extraction failed");
		}
	}

	await onProgress?.("writing_db");
	const stackHeight =
		entry.canlayon || entry.cansiton ? 1.0 : entry.canstandon ? 1.0 : 0.0;
	// allow_stack: derived from stackHeight (mirrors furni-import.ts `dims.z > 0`).
	// allow_walk = canstandon, allow_sit = cansiton, allow_lay = canlayon.
	const allowStack = stackHeight > 0 ? "1" : "0";

	// Auto-detect interaction modes count. The source furnidata flags and the
	// cloned .nitro animation states are real data — keyword guessing is only
	// used when neither is available, so there are no false positives.
	const autoInteraction = autoDetectInteraction(classname, entry.name, {
		cansiton: entry.cansiton,
		canlayon: entry.canlayon,
		canstandon: entry.canstandon,
		// Source furnidata flags are curated → authoritative over keywords.
		hasActionData: true,
		logicType: (clonedNitroJson?.logicType as string) || undefined,
		animationStates: nitroAnimationStatesCount(clonedNitroJson),
	});
	const interactionModesCount = autoInteraction.interactionModesCount;
	// The auto-detected interaction type (wired/gate/teleport/…) is real data
	// (source furnidata + cloned .nitro), never a keyword guess — apply it so
	// wired and mechanical furniture actually work on the emulator.
	const interactionType = autoInteraction.interactionType;

	let newId: number;
	try {
		newId = await allocateItemsBaseId(async (nextId) => {
			await db.execute(sql`
        INSERT INTO items_base
          (id, sprite_id, public_name, item_name, type, width, length, stack_height,
           allow_stack, allow_sit, allow_lay, allow_walk, interaction_type, interaction_modes_count, customparams)
        VALUES
          (${nextId}, ${nextId}, ${entry.name}, ${classname}, ${itemType}, ${entry.xdim}, ${entry.ydim}, ${stackHeight},
           ${allowStack}, ${entry.cansiton ? "1" : "0"}, ${entry.canlayon ? "1" : "0"}, ${entry.canstandon ? "1" : "0"}, ${interactionType}, ${interactionModesCount}, ${entry.customparams})`);
			return nextId;
		});
	} catch (err) {
		// Rollback: remove both downloaded files so we don't leave orphaned assets.
		await fs.unlink(/*turbopackIgnore: true*/ nitroPath).catch(() => {});
		await fs.unlink(/*turbopackIgnore: true*/ iconPath).catch(() => {});
		logger.warn("[clone-import] items_base insert failed for", {
			classname,
			error: (err as Error).message,
		});
		return {
			ok: false,
			classname,
			warnings,
			error: `items_base insert failed: ${(err as Error).message}`,
		};
	}

	// FurnitureData entry — reuse the source's furnitype object, but with our id
	// AND our offerid. The source's offerid points at the source hotel's sprite
	// ids, which would silently break the emulator's catalog offer lookup.
	await onProgress?.("writing_furnidata");
	const furniDataEntry = {
		...entry,
		id: newId,
		offerid: newId,
	} as Record<string, unknown>;
	if (deferFurniData) {
		// Batch mode: the caller collects entries and appends them once at the end.
	} else {
		try {
			await appendFurniEntry(furniDataEntry, itemType);
		} catch (err) {
			logger.warn("[clone-import] FurnitureData append failed for", {
				classname,
				error: (err as Error).message,
			});
			warnings.push(`FurnitureData append failed: ${(err as Error).message}`);
		}
	}

	// Catalog entry (category sub-page + auto price), serialized id allocation.
	// Skip when the item already has a catalog row — re-imports must never
	// create a second row for the same item_ids.
	try {
		const existingCatalog = await queryRows<{ id: number }>(sql`
      SELECT id FROM catalog_items WHERE item_ids = ${String(newId)} LIMIT 1
    `);
		if (existingCatalog.length > 0) {
			warnings.push(
				`catalog entry already exists (#${existingCatalog[0].id}) — skipped duplicate`,
			);
		} else {
			const pageId = await getOrCreateCategoryPage(classname, itemType);
			const price = autoPriceFurni(classname);
			await allocateCatalogItemId(async (nextCatalogId) => {
				await db.execute(sql`
        INSERT INTO catalog_items (id, page_id, item_ids, catalog_name, cost_credits, cost_points, points_type, amount, order_number, offer_id, extradata)
        VALUES (${nextCatalogId}, ${String(pageId)}, ${String(newId)}, ${classname}, ${price.credits}, ${price.points}, ${price.pointsType}, 1, 1, ${nextCatalogId}, '')`);
				return nextCatalogId;
			});
		}
	} catch (err) {
		logger.warn("[clone-import] catalog entry failed for", {
			classname,
			error: (err as Error).message,
		});
		warnings.push(`catalog entry failed: ${(err as Error).message}`);
	}

	return {
		ok: true,
		classname,
		warnings,
		furniDataEntry: deferFurniData
			? { entry: furniDataEntry, itemType }
			: undefined,
	};
}

export async function getCloneList(params: {
	source: CloneSource;
	search: string;
	page: number;
	perPage: number;
	filter?: "all" | "missing" | "present";
}): Promise<{
	items: Array<SourceFurni & { present: boolean }>;
	meta: { page: number; perPage: number; total: number };
}> {
	const { source, search, page, perPage, filter = "all" } = params;
	const all = await fetchSourceFurnidata(source.furnidataUrl);
	const term = search.trim().toLowerCase();
	const searched = term
		? all.filter(
				(e) =>
					e.classname.toLowerCase().includes(term) ||
					e.name.toLowerCase().includes(term),
			)
		: all;

	// Resolve present status across the whole searched list (not just the page),
	// so the missing/present filter and the page total stay correct.
	const allNames = searched.map((e) => e.classname);
	const present = new Set<string>();
	if (allNames.length) {
		const rows = await db
			.select({ itemName: ItemsBase.itemName })
			.from(ItemsBase)
			.where(inArray(ItemsBase.itemName, allNames));
		for (const r of rows) present.add(normalizeClassname(r.itemName));
	}

	const filtered =
		filter === "missing"
			? searched.filter((e) => !present.has(normalizeClassname(e.classname)))
			: filter === "present"
				? searched.filter((e) => present.has(normalizeClassname(e.classname)))
				: searched;

	const total = filtered.length;
	const start = (Math.max(page, 1) - 1) * perPage;
	const slice = filtered.slice(start, start + perPage);
	return {
		items: slice.map((e) => ({
			...e,
			present: present.has(normalizeClassname(e.classname)),
		})),
		meta: { page: Math.max(page, 1), perPage, total },
	};
}

export async function getCloneStats(
	source: CloneSource,
): Promise<{ total: number; present: number; clonable: number }> {
	const all = await fetchSourceFurnidata(source.furnidataUrl);
	const classnames = all.map((e) => e.classname);
	const have = new Set<string>();
	if (classnames.length) {
		const rows = await db
			.select({ itemName: ItemsBase.itemName })
			.from(ItemsBase)
			.where(inArray(ItemsBase.itemName, classnames));
		for (const r of rows) have.add(normalizeClassname(r.itemName));
	}
	const present = all.filter((e) =>
		have.has(normalizeClassname(e.classname)),
	).length;
	return { total: all.length, present, clonable: all.length - present };
}

/**
 * Return the classnames of every furni in the source that is NOT yet present
 * in our items_base — used by the "clone all" action (cloned in chunks by the UI).
 */
export async function getClonableClassnames(
	source: CloneSource,
): Promise<string[]> {
	const all = await fetchSourceFurnidata(source.furnidataUrl);
	const classnames = all.map((e) => e.classname);
	const have = new Set<string>();
	if (classnames.length) {
		const rows = await db
			.select({ itemName: ItemsBase.itemName })
			.from(ItemsBase)
			.where(inArray(ItemsBase.itemName, classnames));
		for (const r of rows) have.add(normalizeClassname(r.itemName));
	}
	return all
		.filter((e) => !have.has(normalizeClassname(e.classname)))
		.map((e) => e.classname);
}
