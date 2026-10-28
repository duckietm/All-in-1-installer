import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, execResult, ItemsBase, queryRows } from "@/lib/db";
import {
	getGamedataRoot,
	getNitroFilesRoot,
} from "@/lib/services/furni-asset-dirs";
import type { OfficialHabboFurniEntry } from "@/lib/services/habbo-furnidata-cache";
import { siteSettings } from "@/lib/services/site-settings";
import type { FurniMetadata } from "@/lib/services/swf-to-nitro";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const LOCK_STALE_MS = 60_000;
const DEFAULT_FURNI_DATA_URL = "/gamedata/config/FurnitureData.json";

/**
 * Resolve the FurnitureData file path from the admin setting
 * `furni_data_url`. The production `/gamedata` mount maps to the configured
 * Gamedata filesystem root; other relative URLs map under public/.
 */
export async function getFurnitureDataPath(): Promise<string> {
	const url =
		(await siteSettings.get("furni_data_url", DEFAULT_FURNI_DATA_URL)) ??
		DEFAULT_FURNI_DATA_URL;
	if (path.isAbsolute(url) && !url.startsWith("/")) return url;
	if (url === "/gamedata" || url.startsWith("/gamedata/")) {
		const gamedataRoot = await getGamedataRoot();
		if (gamedataRoot) {
			const relative = url.replace(/^\/gamedata\/?/, "");
			return getRuntimePath(/*turbopackIgnore: true*/ gamedataRoot, relative);
		}
	}
	const relative = url.replace(/^\/+/, "");
	// The `relative` segment is admin-configurable so its concrete value is
	// unknown at build time; without the hint Turbopack traces the entire
	// public/ tree (~400k files) into the route's NFT.
	return getRuntimePath(
		/*turbopackIgnore: true*/ process.cwd(),
		"public",
		relative,
	);
}

export async function getFurnitureDataWritePaths(): Promise<string[]> {
	const primary = await getFurnitureDataPath();
	const configuredMirror =
		(await siteSettings.get("furni_data_mirror_path", "")) ?? "";
	const [nitroFilesRoot, gamedataRoot] = await Promise.all([
		getNitroFilesRoot(),
		getGamedataRoot(),
	]);
	const mirror = configuredMirror.trim()
		? configuredMirror
		: nitroFilesRoot
			? getRuntimePath(
					/*turbopackIgnore: true*/ nitroFilesRoot,
					"nitro-assets/gamedata/FurnitureData.json",
				)
			: "";

	const gamedataPath = gamedataRoot
		? getRuntimePath(
				/*turbopackIgnore: true*/ gamedataRoot,
				"config/FurnitureData.json",
			)
		: "";
	const paths = [primary, mirror, gamedataPath]
		.filter(Boolean)
		.map((p) => path.normalize(p));
	const seen = new Set<string>();
	return paths.filter((p) => {
		const key = process.platform === "win32" ? p.toLowerCase() : p;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

async function getFurnitureDataReadPath(): Promise<string> {
	const paths = await getFurnitureDataWritePaths();
	const existing = paths.find((p) => existsSync(/*turbopackIgnore: true*/ p));
	return existing ?? paths[0];
}

// ── FurnitureData.json lock + helpers ────────────────────────────────

let furniDataLock: Promise<void> = Promise.resolve();

async function acquireDiskLock(lockPath: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (true) {
		try {
			const fh = await fs.open(lockPath, "wx");
			await fh.writeFile(String(process.pid));
			await fh.close();
			return;
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== "EEXIST") throw err;
			try {
				const stat = await fs.stat(lockPath);
				if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
					await fs.unlink(lockPath).catch(() => {});
					continue;
				}
			} catch {
				/* lock vanished between checks */
			}
			if (Date.now() > deadline) throw new Error("FurnitureData lock timeout");
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

/** Build a map of sprite id → classname from both sections of the furnidata.
 *  If multiple entries share the same id, the first encountered classname wins. */
function furniDataIdOwners(
	data: Record<string, { furnitype: Array<Record<string, unknown>> }>,
): Map<number, string> {
	const owners = new Map<number, string>();
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of data[section]?.furnitype ?? []) {
			const id = Number(e?.id);
			if (!Number.isFinite(id) || id <= 0) continue;
			const classname = typeof e?.classname === "string" ? e.classname : "";
			if (!classname) continue;
			if (!owners.has(id)) owners.set(id, classname);
		}
	}
	return owners;
}

/** Assert that no entry in `entries` has a spriteId already used by a different classname
 *  in the existing furnidata or within this batch.  Throws if a conflict is found. */
function assertNoFurniDataIdConflicts(
	existingOwners: Map<number, string>,
	entries: Array<{ entry: Record<string, unknown>; itemType: string }>,
): void {
	const conflicts: string[] = [];
	for (const { entry } of entries) {
		const id = Number(entry?.id);
		if (!Number.isFinite(id) || id <= 0) continue;
		const classname =
			typeof entry?.classname === "string" ? entry.classname : "";
		const existing = existingOwners.get(id);
		if (existing !== undefined && existing !== classname) {
			conflicts.push(
				`spriteId ${id} already used by "${existing}" in FurnitureData.json ` +
					`(attempted "${classname}")`,
			);
			continue;
		}
		// reserve the id within this batch so a second entry with the same id + different classname
		// is also caught (even though the file hasn't been written yet).
		existingOwners.set(id, classname);
	}
	if (conflicts.length > 0) {
		throw new Error(
			`FurnitureData spriteId conflicts: ${conflicts.join("; ")}`,
		);
	}
}

/** Check if a spriteId is already used by a different classname in the local
 *  FurnitureData.json. Returns the existing classname if there's a conflict,
 *  or null if the spriteId is free or the file couldn't be read. */
export async function findFurniDataIdConflict(
	spriteId: number,
	classname: string,
): Promise<string | null> {
	try {
		const furniData = await readFurniData();
		const owners = furniDataIdOwners(
			furniData as Record<
				string,
				{ furnitype: Array<Record<string, unknown>> }
			>,
		);
		const existing = owners.get(spriteId);
		return existing !== undefined && existing !== classname ? existing : null;
	} catch {
		return null; // if file missing/unreadable, treat as no conflict
	}
}

const CHAIN_TIMEOUT_MS = 60_000;

/**
 * Wait for the previous lock holder with a timeout.
 * If the holder stalled (e.g. process crash, unhandled rejection),
 * we break the chain instead of waiting forever.
 */
async function waitForFurniDataLock(): Promise<void> {
	const prev = furniDataLock;
	if (prev === Promise.resolve()) return;

	try {
		await Promise.race([
			prev,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("furni-data chain timeout")),
					CHAIN_TIMEOUT_MS,
				),
			),
		]);
	} catch {
		// Chain holder timed out or crashed — break the chain
		furniDataLock = Promise.resolve();
	}
}

export async function withFurniDataLock<T>(fn: () => Promise<T>): Promise<T> {
	let release!: () => void;
	const acquired = new Promise<void>((r) => {
		release = r;
	});

	await waitForFurniDataLock();
	furniDataLock = acquired;

	const lockBase = await getFurnitureDataReadPath();
	await fs.mkdir(path.dirname(lockBase), { recursive: true });
	const lockPath = `${lockBase}.lock`;
	await acquireDiskLock(lockPath);
	try {
		return await fn();
	} finally {
		await fs.unlink(lockPath).catch(() => {});
		furniDataLock = Promise.resolve();
		release?.();
	}
}

let cachedFurniData: {
	path: string;
	mtimeMs: number;
	size: number;
	data: Record<string, unknown>;
} | null = null;

export async function readFurniData(): Promise<Record<string, unknown>> {
	const target = await getFurnitureDataReadPath();
	const stat = await fs.stat(target);
	if (
		cachedFurniData &&
		cachedFurniData.path === target &&
		cachedFurniData.mtimeMs === stat.mtimeMs &&
		cachedFurniData.size === stat.size
	) {
		// File unchanged since last parse: skip the (expensive) full JSON.parse.
		return cachedFurniData.data;
	}
	const raw = await fs.readFile(/*turbopackIgnore: true*/ target, "utf-8");
	const data = JSON.parse(raw) as Record<string, unknown>;
	cachedFurniData = {
		path: target,
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		data,
	};
	return data;
}

export async function writeFurniData(
	data: Record<string, unknown>,
): Promise<void> {
	const targets = await getFurnitureDataWritePaths();
	const payload = JSON.stringify(data);
	for (const target of targets) {
		await fs.mkdir(path.dirname(target), { recursive: true });
		const tmp = `${target}.tmp`;
		await fs.writeFile(/*turbopackIgnore: true*/ tmp, payload, "utf-8");
		await fs.rename(/*turbopackIgnore: true*/ tmp, target);
	}
	// The file just changed: force the next read to reparse instead of serving
	// a possibly-mutated cached object.
	cachedFurniData = null;
	void purgeFurniGamedataEdge(
		`furnidata written (${targets.length} target(s))`,
	);
}

/**
 * Drop the edge copy of every gamedata file after a furniture write.
 *
 * The Habbo client reads FurnitureData.json from /gamedata/, which nginx
 * serves with its own TTL and Cloudflare with an edge TTL. Neither knows
 * about a write that happened on disk, so without this purge a freshly
 * imported item stays invisible in the client until both expire. The purge
 * used to hang off the catalog Git export, which is disabled in production,
 * so in practice it never ran.
 *
 * Fire-and-forget and swallowed on every level: a stale edge copy is bounded
 * by the edge TTL, so failing to purge must never fail the import itself.
 * Standalone scripts reach this through `tsx` without the react-server
 * condition, where `server-only` throws on import, hence the try/catch.
 */
async function purgeFurniGamedataEdge(reason: string): Promise<void> {
	try {
		const { EDGE_CACHE_TAGS, purgeEdgeCache } = await import(
			"@/lib/edge-cache"
		);
		await purgeEdgeCache([EDGE_CACHE_TAGS.gamedata], reason);
	} catch {
		/* no Cloudflare credentials, or a non-server runtime: nothing to purge */
	}
}

export function buildFurniEntry(params: {
	id: number;
	classname: string;
	revision: number;
	category: string;
	name: string;
	description: string;
	spriteId: number;
	dims: { x: number; y: number; z: number };
	metadata: FurniMetadata | null;
	officialHabbo?: OfficialHabboFurniEntry | null;
}): Record<string, unknown> {
	const {
		id,
		classname,
		revision,
		category,
		name,
		description,
		spriteId,
		dims,
		metadata,
		officialHabbo,
	} = params;

	// Prefer the configured official hotel's real hex colors, then .nitro metadata.
	const partcolors = officialHabbo?.partcolors?.color?.length
		? officialHabbo.partcolors
		: (metadata?.partcolors ?? { color: [] });

	return {
		id,
		classname,
		revision: revision || officialHabbo?.revision || 0,
		category: category || officialHabbo?.category || "unknown",
		defaultdir: metadata?.defaultdir ?? officialHabbo?.defaultdir ?? 0,
		xdim: dims.x,
		ydim: dims.y,
		partcolors,
		name,
		description: description || "",
		adurl: "",
		offerid: spriteId,
		buyout: !!officialHabbo?.bc,
		rentofferid: -1,
		rentbuyout: false,
		bc: officialHabbo?.bc ?? false,
		excludeddynamic: false,
		customparams: officialHabbo?.customparams ?? "",
		specialtype: metadata?.specialtype ?? officialHabbo?.specialtype ?? 0,
		canstandon: metadata?.canstandon ?? officialHabbo?.canstandon ?? false,
		cansiton: metadata?.cansiton ?? officialHabbo?.cansiton ?? false,
		canlayon: metadata?.canlayon ?? officialHabbo?.canlayon ?? false,
		furniline: officialHabbo?.furniline ?? "",
		environment: officialHabbo?.environment ?? "",
		rare: officialHabbo?.rare ?? false,
	};
}

function upsertEntryInSection(
	section: { furnitype: Array<Record<string, unknown>> },
	entry: Record<string, unknown>,
) {
	const classname = entry.classname as string | undefined;
	if (classname) {
		const idx = section.furnitype.findIndex((e) => e.classname === classname);
		if (idx >= 0) {
			section.furnitype[idx] = entry;
			return;
		}
	}
	section.furnitype.push(entry);
}

export async function appendFurniEntry(
	entry: Record<string, unknown>,
	itemType: string,
): Promise<void> {
	await withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;

		// Guard: ensure the spriteId is not already used by a different classname in the file.
		const existingOwners = furniDataIdOwners(furniData);
		assertNoFurniDataIdConflicts(existingOwners, [{ entry, itemType }]);

		if (itemType === "i") {
			if (!furniData.wallitemtypes) furniData.wallitemtypes = { furnitype: [] };
			upsertEntryInSection(furniData.wallitemtypes, entry);
		} else {
			if (!furniData.roomitemtypes) furniData.roomitemtypes = { furnitype: [] };
			upsertEntryInSection(furniData.roomitemtypes, entry);
		}
		await writeFurniData(furniData as Record<string, unknown>);
	});
}

/**
 * Append many FurnitureData entries in a single read/parse/write cycle
 * (under the furnidata lock). Used by batch imports so the whole JSON file
 * is rewritten once instead of once per item.
 */
export async function appendFurniEntriesBulk(
	entries: Array<{ entry: Record<string, unknown>; itemType: string }>,
): Promise<void> {
	if (entries.length === 0) return;
	await withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;
		const existingOwners = furniDataIdOwners(furniData);
		assertNoFurniDataIdConflicts(existingOwners, entries);
		for (const { entry, itemType } of entries) {
			if (itemType === "i") {
				if (!furniData.wallitemtypes)
					furniData.wallitemtypes = { furnitype: [] };
				upsertEntryInSection(furniData.wallitemtypes, entry);
			} else {
				if (!furniData.roomitemtypes)
					furniData.roomitemtypes = { furnitype: [] };
				upsertEntryInSection(furniData.roomitemtypes, entry);
			}
		}
		await writeFurniData(furniData as Record<string, unknown>);
	});
}

export async function removeFurniEntry(classname: string): Promise<boolean> {
	return withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;
		let removed = false;

		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			if (furniData[section]?.furnitype) {
				const before = furniData[section].furnitype.length;
				furniData[section].furnitype = furniData[section].furnitype.filter(
					(e) => e.classname !== classname,
				);
				if (furniData[section].furnitype.length < before) removed = true;
			}
		}

		if (removed) {
			await writeFurniData(furniData as Record<string, unknown>);
		}
		return removed;
	});
}

/**
 * Patch name/description on existing FurnitureData entries by classname.
 * Optionally creates a minimal entry when missing.
 */
export async function patchFurniEntryNames(
	updates: Array<{
		classname: string;
		itemType: string;
		name?: string;
		description?: string;
		spriteId?: number;
		createIfMissing?: boolean;
	}>,
): Promise<{ updated: number; inserted: number }> {
	if (updates.length === 0) return { updated: 0, inserted: 0 };

	return withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;
		let updated = 0;
		let inserted = 0;

		for (const u of updates) {
			const sectionKey = u.itemType === "i" ? "wallitemtypes" : "roomitemtypes";
			if (!furniData[sectionKey]) furniData[sectionKey] = { furnitype: [] };
			const section = furniData[sectionKey];
			const idx = section.furnitype.findIndex(
				(e) => e.classname === u.classname,
			);

			if (idx >= 0) {
				const entry = { ...section.furnitype[idx] };
				if (u.name !== undefined) entry.name = u.name;
				if (u.description !== undefined) entry.description = u.description;
				section.furnitype[idx] = entry;
				updated++;
			} else if (u.createIfMissing) {
				section.furnitype.push({
					id: u.spriteId ?? 0,
					classname: u.classname,
					revision: 0,
					category: "unknown",
					name: u.name ?? u.classname,
					description: u.description ?? "",
					offerid: u.spriteId ?? -1,
				});
				inserted++;
			}
		}

		if (updated > 0 || inserted > 0) {
			await writeFurniData(furniData as Record<string, unknown>);
		}
		return { updated, inserted };
	});
}

export async function appendFurniEntriesBatch(
	entries: Array<{ entry: Record<string, unknown>; itemType: string }>,
): Promise<void> {
	await withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: unknown[] }
		>;

		// Guard: ensure no spriteId conflicts with existing file entries
		// or within this batch (same id + different classname).
		const existingOwners = furniDataIdOwners(
			furniData as Record<
				string,
				{ furnitype: Array<Record<string, unknown>> }
			>,
		);
		assertNoFurniDataIdConflicts(existingOwners, entries);

		for (const { entry, itemType } of entries) {
			if (itemType === "i") {
				if (!furniData.wallitemtypes)
					furniData.wallitemtypes = { furnitype: [] };
				upsertEntryInSection(
					furniData.wallitemtypes as {
						furnitype: Array<Record<string, unknown>>;
					},
					entry,
				);
			} else {
				if (!furniData.roomitemtypes)
					furniData.roomitemtypes = { furnitype: [] };
				upsertEntryInSection(
					furniData.roomitemtypes as {
						furnitype: Array<Record<string, unknown>>;
					},
					entry,
				);
			}
		}
		await writeFurniData(furniData as Record<string, unknown>);
	});
}

export interface FurniDataReconcileResult {
	/** Entries whose stale spriteId was corrected to the DB id. */
	fixedIds: number;
	/** Entries whose stale offerid was corrected to the DB id. */
	fixedOfferIds: number;
	/** Cross-section copies (same classname in both sections) whose stale id was aligned to their offerid. */
	normalizedIds: number;
	/** items_base rows with no matching furnitype entry (need re-import). */
	missing: number;
	/** spriteIds used by a different classname in the file, now resolved by
	 *  overwriting the entry's classname with the items_base (authoritative)
	 *  value so the client renders the correct furniture. */
	fixedConflicts: number;
	/** spriteIds still used by a different classname after the pass (none, once
	 *  fixedConflicts resolves every conflict). */
	conflicts: number;
}

/**
 * Cross-check every items_base row against the local FurnitureData.json and
 * repair drift:
 * - an entry matching the classname but carrying a stale spriteId is updated
 *   to the DB id (items_base is authoritative);
 * - the same is done for a stale `offerid`, which must equal the spriteId so
 *   the emulator's catalog offer lookup stays in sync with the local ids;
 * - rows missing entirely from the file are counted (they need a re-import
 *   or batch-regen, since building an entry requires the SWF/nitro metadata);
 * - genuine spriteId conflicts (id used by a different classname) are resolved
 *   in favour of items_base: the furnidata entry occupying that id has its
 *   classname overwritten with the items_base classname, so the client renders
 *   the real (imported) furniture instead of a legacy/conflicting one.
 */
export async function reconcileFurniDataWithItemsBase(): Promise<FurniDataReconcileResult> {
	return withFurniDataLock(async () => {
		const rows = await db
			.select({ id: ItemsBase.id, itemName: ItemsBase.itemName })
			.from(ItemsBase);

		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;

		const byId = new Map<
			number,
			{ section: string; index: number; entry: Record<string, unknown> }
		>();
		const byClass = new Map<
			string,
			{ section: string; index: number; entry: Record<string, unknown> }
		>();
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			const arr = furniData[section]?.furnitype ?? [];
			for (let i = 0; i < arr.length; i++) {
				const e = arr[i];
				const id = Number(e?.id);
				if (Number.isFinite(id) && id > 0 && !byId.has(id)) {
					byId.set(id, { section, index: i, entry: e });
				}
				const cn = typeof e?.classname === "string" ? e.classname : "";
				if (cn && !byClass.has(cn)) {
					byClass.set(cn, { section, index: i, entry: e });
				}
			}
		}

		let fixedIds = 0;
		let fixedOfferIds = 0;
		let normalizedIds = 0;
		let missing = 0;
		let fixedConflicts = 0;
		const conflicts = 0;

		const entryOfferId = (entry: Record<string, unknown>): number => {
			const v = Number(entry.offerid);
			return Number.isFinite(v) ? v : -1;
		};

		for (const row of rows) {
			const spriteId = row.id;
			const existing = byId.get(spriteId);
			if (existing) {
				if (existing.entry.classname !== row.itemName) {
					// items_base is authoritative: this furnidata entry sits at the
					// wrong classname for this id (legacy/conflicting data). Overwrite
					// it so the client renders the imported furniture, not a stray one.
					const displaced = String(existing.entry.classname ?? "");
					existing.entry.classname = row.itemName;
					existing.entry.id = spriteId;
					existing.entry.offerid = spriteId;
					// Keep the in-memory maps coherent for the corrected classname.
					byClass.set(row.itemName, existing);
					if (displaced) byClass.delete(displaced);
					fixedConflicts++;
				} else if (entryOfferId(existing.entry) !== spriteId) {
					existing.entry.offerid = spriteId;
					fixedOfferIds++;
				}
				continue;
			}
			const byName = byClass.get(row.itemName);
			if (byName) {
				byName.entry.id = spriteId;
				if (entryOfferId(byName.entry) !== spriteId) {
					byName.entry.offerid = spriteId;
				}
				byId.set(spriteId, byName);
				fixedIds++;
			} else {
				missing++;
			}
		}

		// Normalize cross-section duplicates (e.g. a wall item listed in both
		// roomitemtypes and wallitemtypes). The canonical copy already has the
		// correct id/offerid; a stray copy may carry a legacy wrong `id` while
		// its offerid still points at the right sprite. Only fix when the
		// offerid maps to an items_base row whose classname matches this entry
		// exactly, so we never guess.
		const dbById = new Map<number, string>();
		for (const row of rows) dbById.set(row.id, row.itemName);
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const e of furniData[section]?.furnitype ?? []) {
				const offer = entryOfferId(e);
				if (offer <= 0 || Number(e.id) === offer) continue;
				if (dbById.get(offer) !== e.classname) continue;
				e.id = offer;
				normalizedIds++;
			}
		}

		if (fixedIds > 0 || fixedOfferIds > 0 || fixedConflicts > 0) {
			await writeFurniData(furniData as Record<string, unknown>);
		}
		return {
			fixedIds,
			fixedOfferIds,
			normalizedIds,
			missing,
			fixedConflicts,
			conflicts,
		};
	});
}

export interface CatalogOfferRebuildResult {
	/** catalog_items rows examined. */
	checked: number;
	/** Rows whose offer_id was corrected. */
	fixed: number;
}

/**
 * Force EVERY catalog_items.offer_id to equal its own row id.
 *
 * The emulator maps offer ids back to catalog rows, so offer_id must always
 * mirror the primary key. Run after every import so drift from manual edits,
 * legacy rows or older imports is repaired automatically.
 */
export async function rebuildCatalogOfferIds(): Promise<CatalogOfferRebuildResult> {
	return withFurniDataLock(async () => {
		const countRows = await queryRows<{ total: number }>(
			sql`SELECT COUNT(*) AS total FROM catalog_items`,
		);
		const checked = Number(countRows?.[0]?.total ?? 0);

		const result = await execResult(sql`
      UPDATE catalog_items SET offer_id = id WHERE offer_id <> id
    `);

		return { checked, fixed: Number(result.affectedRows ?? 0) };
	});
}

export interface SpriteIdVerifyResult {
	/** items_base rows examined. */
	checked: number;
	/** Rows whose sprite_id was corrected to their id. */
	fixed: number;
}

/**
 * Verify that every items_base.sprite_id matches its id whenever the local
 * FurnitureData.json carries the item under that id.
 *
 * The emulator sends sprite_id to the client and Nitro resolves the furniture
 * by looking up that id in the furnidata — a stale sprite_id makes the client
 * render a completely different item (e.g. a wired or a custom in place of a
 * seaside sofa). Imports always write sprite_id = id, but legacy rows may
 * drift; this pass repairs them after every import.
 */
export async function verifyAndFixSpriteIds(): Promise<SpriteIdVerifyResult> {
	return withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype?: Array<Record<string, unknown>> }
		>;
		const classById = new Map<number, Set<string>>();
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const e of furniData[section]?.furnitype ?? []) {
				const entryId = Number(e?.id);
				const cn = typeof e?.classname === "string" ? e.classname : "";
				if (!Number.isFinite(entryId) || !cn) continue;
				const set = classById.get(entryId) ?? new Set<string>();
				set.add(cn);
				classById.set(entryId, set);
			}
		}

		const rows = await db
			.select({
				id: ItemsBase.id,
				spriteId: ItemsBase.spriteId,
				itemName: ItemsBase.itemName,
			})
			.from(ItemsBase);

		let fixed = 0;
		for (const row of rows) {
			if (row.spriteId === row.id) continue;
			const entries = classById.get(row.id);
			if (!entries?.has(row.itemName)) continue;
			await db
				.update(ItemsBase)
				.set({ spriteId: row.id })
				.where(eq(ItemsBase.id, row.id));
			fixed++;
		}
		return { checked: rows.length, fixed };
	});
}
