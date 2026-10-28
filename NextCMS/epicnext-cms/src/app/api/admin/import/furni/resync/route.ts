import { existsSync } from "node:fs";
import { asc, inArray, sql } from "drizzle-orm";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { normalizeClassname } from "@/lib/furni/classname";
import { PERMS } from "@/lib/permission-slugs";
import {
	fetchSourceFurnidata,
	type SourceFurni,
} from "@/lib/services/clone-import";
import { type CloneSource, listSources } from "@/lib/services/clone-sources";
import {
	appendFurniEntriesBatch,
	buildFurniEntry,
	getFurnitureDataPath,
	readFurniData,
} from "@/lib/services/furni-data";
import {
	clearFurniImportCache,
	getLocalCatalogSnapshot,
} from "@/lib/services/furni-import-cache";
import { lookupOfficialHabboFurni } from "@/lib/services/habbo-furnidata-cache";
import { rcon } from "@/lib/services/rcon";
import type { OfficialHabboFurniEntry } from "@/types/furni";

/**
 * POST /api/admin/import/furni/resync
 *
 * Modes (pick one):
 *   ?days=N    — items imported in the last N days (from admin_audit_log).
 *   ?missing=1 — every items_base row whose classname is absent from
 *                FurnitureData.json (authoritative for "what's broken").
 *   ?all=1     — every items_base row (rebuilds entries for all imports).
 *   body       — { classnames: string[] } targets just those rows, which is
 *                what the Studio "Add missing furnidata" bulk action uses.
 *
 * Default: ?days=7
 *
 * Entries are upserted by classname so running this repeatedly is safe.
 * Triggers RCON updateCatalog + updateItems at the end.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const qp = request.nextUrl.searchParams;

		// Targeted mode: the Studio sends the classnames of the selected rows so
		// only those get an entry. Everything else keeps using the query params.
		const body = (await request.json().catch(() => null)) as {
			classnames?: unknown;
		} | null;
		const classnames = Array.isArray(body?.classnames)
			? body.classnames
					.filter((c): c is string => typeof c === "string")
					.map((c) => c.trim())
					.filter(Boolean)
			: null;

		const days = Math.max(
			1,
			Math.min(parseInt(qp.get("days") || "7", 10) || 7, 365),
		);

		let mode: "days" | "missing" | "broken" | "all" | "classnames";
		let targetIds: number[];
		if (classnames != null) {
			mode = "classnames";
			targetIds = await resolveClassnames(classnames);
		} else {
			mode =
				qp.get("all") === "1"
					? "all"
					: qp.get("broken") === "1"
						? "broken"
						: qp.get("missing") === "1"
							? "missing"
							: "days";
			targetIds = await resolveTargetIds(mode, days);
		}

		if (targetIds.length === 0) {
			return apiOk({
				mode,
				days: mode === "days" ? days : undefined,
				examined: 0,
				resynced: 0,
				failed: 0,
				errors: [],
			});
		}

		// Process in chunks to keep memory flat and make progress visible.
		const CHUNK = 500;
		let resynced = 0;
		const errors: Array<{ classname: string; message: string }> = [];

		// Configured clone sources' furnidata, indexed by normalized classname.
		// Memoized for this request only: a module-level cache would pin the
		// source list for the life of the process, so a source added later would
		// never be picked up. `fetchSourceFurnidata` already caches per URL, so
		// building this per request costs one parse, not one network round-trip.
		let cloneSourceIndex: Promise<Map<string, OfficialHabboFurniEntry>> | null =
			null;
		const cloneIndex = () => (cloneSourceIndex ??= buildCloneSourceIndex());

		for (let i = 0; i < targetIds.length; i += CHUNK) {
			const slice = targetIds.slice(i, i + CHUNK);
			const rows = await db
				.select({
					id: ItemsBase.id,
					spriteId: ItemsBase.spriteId,
					itemName: ItemsBase.itemName,
					publicName: ItemsBase.publicName,
					type: ItemsBase.type,
					width: ItemsBase.width,
					length: ItemsBase.length,
					stackHeight: ItemsBase.stackHeight,
				})
				.from(ItemsBase)
				.where(inArray(ItemsBase.id, slice));

			const entries: Array<{
				entry: Record<string, unknown>;
				itemType: string;
			}> = [];
			for (const row of rows) {
				try {
					const classname = row.itemName;
					let officialHabbo = null;
					try {
						officialHabbo = await lookupOfficialHabboFurni(classname);
					} catch {
						/* optional */
					}
					// A retro-hotel classname (leet.ws et al.) is absent from the
					// official Habbo furnidata, so fall back to the configured clone
					// sources. Without this the entry was written with revision 0,
					// category "unknown" and an empty description.
					if (!officialHabbo) {
						officialHabbo =
							(await cloneIndex()).get(normalizeClassname(classname)) ?? null;
					}

					const entry = buildFurniEntry({
						id: row.id,
						classname,
						revision: officialHabbo?.revision ?? 0,
						category: officialHabbo?.category || "unknown",
						name: row.publicName || officialHabbo?.name || classname,
						description: officialHabbo?.description || "",
						spriteId: row.spriteId,
						dims: {
							x: row.width,
							y: row.length,
							z: Math.round(Number(row.stackHeight)),
						},
						metadata: null,
						officialHabbo,
					});

					entries.push({ entry, itemType: row.type === "i" ? "i" : "s" });
				} catch (err) {
					errors.push({
						classname: row.itemName,
						message: (err as Error).message,
					});
				}
			}

			if (entries.length > 0) {
				try {
					await appendFurniEntriesBatch(entries);
					resynced += entries.length;
				} catch (err) {
					errors.push({
						classname: `_chunk_${i}_${i + slice.length}_`,
						message: `FurnitureData.json write failed: ${(err as Error).message}`,
					});
					break;
				}
			}
		}

		// FurnitureData.json changed — drop the Studio's cached classname set so
		// the next listing recomputes `hasFurnidata` instead of serving stale hits.
		clearFurniImportCache();

		let rconOk = false;
		try {
			const a = await rcon.updateCatalog();
			const b = await rcon.updateItems();
			rconOk = a && b;
		} catch {
			/* logged in rcon service */
		}

		return apiOk({
			mode,
			days: mode === "days" ? days : undefined,
			examined: targetIds.length,
			resynced,
			failed: errors.length,
			rconOk,
			errors: errors.slice(0, 50),
		});
	},
);

async function buildCloneSourceIndex(): Promise<
	Map<string, OfficialHabboFurniEntry>
> {
	const index = new Map<string, OfficialHabboFurniEntry>();
	let sources: CloneSource[];
	try {
		sources = await listSources();
	} catch {
		// Without the source list we simply fall back to items_base values.
		return index;
	}
	for (const source of sources) {
		if (source.enabled === false || !source.furnidataUrl) continue;
		try {
			for (const entry of await fetchSourceFurnidata(source.furnidataUrl)) {
				const key = normalizeClassname(entry.classname);
				if (key && !index.has(key)) index.set(key, toFurniEnrichment(entry));
			}
		} catch {
			// An unreachable source is skipped; its classnames keep falling back
			// to items_base rather than failing the whole resync.
		}
	}
	return index;
}

/**
 * A clone source entry is the same JSON shape as an official Habbo one, so it
 * can drive the same enrichment fallbacks in `buildFurniEntry`. Mirrors the
 * coercion the official furnidata cache applies.
 */
function toFurniEnrichment(entry: SourceFurni): OfficialHabboFurniEntry {
	return {
		id: entry.id,
		classname: entry.classname,
		revision: Number(entry.revision ?? 0),
		category: String(entry.category ?? ""),
		defaultdir: Number(entry.defaultdir ?? 0),
		xdim: entry.xdim,
		ydim: entry.ydim,
		partcolors: toPartcolors(entry.partcolors),
		name: entry.name,
		description: entry.description,
		specialtype: Number(entry.specialtype ?? 0),
		canstandon: entry.canstandon,
		cansiton: entry.cansiton,
		canlayon: entry.canlayon,
		furniline: String(entry.furniline ?? ""),
		environment: String(entry.environment ?? ""),
		rare: entry.rare === true,
		tradeable: entry.tradeable === true,
		bc: entry.bc === true,
		customparams: String(entry.customparams ?? ""),
		itemType: entry.itemType,
	};
}

function toPartcolors(raw: unknown): { color: string[] } {
	// Only the `{ color: [...] }` shape is understood, same as the official
	// furnidata cache. A flat colour array is dropped rather than guessed at.
	const color = (raw as { color?: unknown } | null | undefined)?.color;
	return Array.isArray(color) ? (raw as { color: string[] }) : { color: [] };
}

async function resolveClassnames(classnames: string[]): Promise<number[]> {
	if (classnames.length === 0) return [];
	const { localIndex } = await getLocalCatalogSnapshot();
	const ids = new Set<number>();
	for (const classname of classnames) {
		for (const row of localIndex.get(normalizeClassname(classname)) ?? []) {
			ids.add(row.id);
		}
	}
	return [...ids];
}

async function resolveTargetIds(
	mode: "days" | "missing" | "broken" | "all",
	days: number,
): Promise<number[]> {
	if (mode === "all") {
		const rows = await db
			.select({ id: ItemsBase.id })
			.from(ItemsBase)
			.orderBy(asc(ItemsBase.id));
		return rows.map((r) => r.id);
	}

	if (mode === "missing" || mode === "broken") {
		const furniDataPath = await getFurnitureDataPath();
		if (!existsSync(furniDataPath)) {
			const rows = await db
				.select({ id: ItemsBase.id })
				.from(ItemsBase)
				.orderBy(asc(ItemsBase.id));
			return rows.map((r) => r.id);
		}
		const furniData = (await readFurniData()) as {
			roomitemtypes?: { furnitype: Array<Record<string, unknown>> };
			wallitemtypes?: { furnitype: Array<Record<string, unknown>> };
		};
		const byClassname = new Map<string, Record<string, unknown>>();
		for (const section of [furniData.roomitemtypes, furniData.wallitemtypes]) {
			for (const e of section?.furnitype ?? []) {
				if (typeof e?.classname === "string") byClassname.set(e.classname, e);
			}
		}
		const rows = await db
			.select({
				id: ItemsBase.id,
				itemName: ItemsBase.itemName,
				spriteId: ItemsBase.spriteId,
				width: ItemsBase.width,
				length: ItemsBase.length,
			})
			.from(ItemsBase)
			.orderBy(asc(ItemsBase.id));

		if (mode === "missing") {
			return rows.filter((r) => !byClassname.has(r.itemName)).map((r) => r.id);
		}

		// broken: entry present but inconsistent with items_base
		return rows
			.filter((r) => {
				const e = byClassname.get(r.itemName);
				if (!e) return true;
				const entryId = Number(e.id ?? -1);
				if (entryId !== r.id && entryId !== r.spriteId) return true;
				const xdim = Number(e.xdim ?? 0);
				const ydim = Number(e.ydim ?? 0);
				if (xdim <= 0 || ydim <= 0) return true;
				if (xdim !== r.width || ydim !== r.length) return true;
				return false;
			})
			.map((r) => r.id);
	}

	// mode === 'days'
	const sinceIso = new Date(
		Date.now() - days * 24 * 60 * 60 * 1000,
	).toISOString();
	const sinceMysql = sinceIso.slice(0, 19).replace("T", " ");
	const auditRows = await queryRows<{ target_id: number }>(sql`
    SELECT DISTINCT target_id
    FROM admin_audit_log
    WHERE action = 'furni_import'
      AND target = 'ItemsBase'
      AND target_id IS NOT NULL
      AND created_at >= ${sinceMysql}
    ORDER BY target_id ASC
  `);
	return auditRows.map((r) => r.target_id).filter(Boolean);
}
