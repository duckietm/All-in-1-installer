import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase, queryRows } from "@/lib/db";
import {
	bundleExistsInDir,
	bundleWritePathInDir,
} from "@/lib/furni/bundle-file";
import { isSafeAssetName, normalizeClassname } from "@/lib/furni/classname";
import { localFurnitureStatus } from "@/lib/furni/local-presence";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { getCloneList } from "@/lib/services/clone-import";
import { getSource } from "@/lib/services/clone-sources";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import {
	appendFurniEntriesBulk,
	rebuildCatalogOfferIds,
	reconcileFurniDataWithItemsBase,
	verifyAndFixSpriteIds,
} from "@/lib/services/furni-data";
import {
	buildLocalizedFurniDataFiles,
	patchLocalizedFurniDataEntries,
} from "@/lib/services/furni-data-i18n";
import {
	cleanupConvertedSwfs,
	deleteImportedItem,
	downloadFile,
	ensureDirectories,
	ensureFurniOwnership,
	fixDatabaseConsistencyAfterImport,
	importSingleFurni,
	reconcileImportedOfferIds,
	syncAssetsToGamedataBundle,
	verifyAndFixInteractionModesCount,
} from "@/lib/services/furni-import";
import {
	clearFurniImportCache,
	getCatalogIdSet,
	getFurniDataClassnames,
	getFurniImportStats,
	getLocalCatalogSnapshot,
	nitroExistsCached,
} from "@/lib/services/furni-import-cache";
import { getOfficialHabboFurnidata } from "@/lib/services/habbo-furnidata-cache";
import { listFurniture } from "@/lib/services/habbofurni";
import { streamImportResponse } from "@/lib/services/import/core/single-response";
import { rcon } from "@/lib/services/rcon";
import { convertSwfToNitro } from "@/lib/services/swf-to-nitro";

// No value re-exports here. A route module may only export HTTP verbs and
// config, and Next's generated types reject anything else — `tsc --noEmit` does
// not see it, because the check lives in `.next/types`. Both of these are
// imported from `@/lib/services/furni-import` where they are actually needed.
export type { ImportSingleResult } from "@/types/furni";

import type { ImportSingleResult } from "@/types/furni";

// How many items to import concurrently in a batch. The per-item work is
// network-bound (asset downloads) and DB-bound, so a modest pool gives a large
// speedup over the old fully sequential loop without overwhelming the DB.
const IMPORT_BATCH_CONCURRENCY = 3;

async function runWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			for (;;) {
				const i = cursor++;
				if (i >= items.length) break;
				out[i] = await fn(items[i]);
				await new Promise((r) => setImmediate(r));
			}
		},
	);
	await Promise.all(workers);
	return out;
}

// ── Delete imported item or clean up SWF files ──────────────────────
export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const classname = request.nextUrl.searchParams.get("classname");

		// ── Delete specific imported item ─────────────────────────────────
		if (classname) {
			try {
				const { spriteId, deletedFiles, errors } =
					await deleteImportedItem(classname);

				// Refresh game server caches
				try {
					await rcon.updateCatalog();
					await rcon.updateItems();
				} catch (err) {
					errors.push(`RCON: ${(err as Error).message}`);
				}
				invalidateCatalogTotals();

				logAudit({
					userId: ctx.session.user.id,
					action: "furni_delete",
					target: "ItemsBase",
					targetId: spriteId,
					after: {
						classname,
						deletedFiles,
						errors: errors.length > 0 ? errors : undefined,
					},
				});

				clearFurniImportCache();

				return apiOk({
					classname,
					deletedFiles,
					errors: errors.length > 0 ? errors : undefined,
				});
			} catch (err) {
				return apiError((err as Error).message, 404);
			}
		}

		// ── Clean up SWF files that have been converted to Nitro ──────────
		const result = await cleanupConvertedSwfs();

		if (result.total === 0 && result.deleted === 0) {
			return apiOk({ deleted: 0, message: "SWF directory does not exist" });
		}

		return apiOk({
			deleted: result.deleted,
			total: result.total,
			remaining: result.remaining,
			errors: result.errors.length > 0 ? result.errors : undefined,
		});
	},
);

// ── Search furni via official Habbo furnidata ───────────────────────
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const { nitroDir } = await getFurniAssetDirs();
		// Stats endpoint
		const action = request.nextUrl.searchParams.get("action");
		if (action === "stats") {
			return apiOk(await getFurniImportStats(nitroDir));
		}

		// Live furnidata reconcile (without hotel RCON reload)
		if (action === "live-reconcile") {
			const furniReconcile = await reconcileFurniDataWithItemsBase();
			const offerRebuild = await rebuildCatalogOfferIds();
			const spriteVerify = await verifyAndFixSpriteIds();
			return apiOk({
				furniDataFixedIds: furniReconcile.fixedIds,
				furniDataFixedOfferIds: furniReconcile.fixedOfferIds,
				furniDataMissing: furniReconcile.missing,
				furniDataConflicts: furniReconcile.conflicts,
				offerRebuildChecked: offerRebuild.checked,
				offerRebuildFixed: offerRebuild.fixed,
				spriteChecked: spriteVerify.checked,
				spriteFixed: spriteVerify.fixed,
			});
		}

		if (action === "build-languages") {
			const languages = await buildLocalizedFurniDataFiles(true);
			return apiOk({ languages });
		}

		// Missing nitro endpoint: returns only imported items missing .nitro files
		if (action === "missing-nitro") {
			const pageNum = parseInt(
				request.nextUrl.searchParams.get("page") || "1",
				10,
			);
			const perPage = 500;

			const importedItems = await queryRows<{
				item_name: string;
				public_name: string;
				sprite_id: number;
				type: string;
			}>(sql`
        SELECT ib.item_name, ib.public_name, ib.sprite_id, ib.type FROM items_base ib
        WHERE EXISTS (
          SELECT 1 FROM catalog_items ci
          WHERE FIND_IN_SET(ib.id, REPLACE(ci.item_ids, ';', ',')) > 0
        )
      `);

			// Filter to only those missing .nitro on filesystem (memoized — fast)
			const missing = importedItems.filter((item) => {
				const starIdx = item.item_name.indexOf("*");
				const base =
					starIdx !== -1
						? item.item_name.substring(0, starIdx)
						: item.item_name;
				return !nitroExistsCached(nitroDir, base);
			});

			const total = missing.length;
			const lastPage = Math.max(Math.ceil(total / perPage), 1);
			const start = (pageNum - 1) * perPage;
			const pageItems = missing.slice(start, start + perPage);

			// Enrich with revision from official furnidata
			const furnidata = await getOfficialHabboFurnidata();
			const items = pageItems.map((item) => {
				const fd =
					furnidata.get(item.item_name) ||
					furnidata.get(item.item_name.split("*")[0]) ||
					furnidata.get(`${item.item_name}*0`);
				return {
					id: item.sprite_id,
					classname: item.item_name,
					name: item.public_name || item.item_name,
					description: fd?.description || "",
					type: item.type === "i" ? "wallitem" : "flooritem",
					revision: fd?.revision || 0,
					category: fd?.category || fd?.furniline || "",
					alreadyImported: true,
					nitroExists: false,
				};
			});

			return apiOk({
				items,
				meta: { currentPage: pageNum, lastPage, total, perPage },
			});
		}

		const search = request.nextUrl.searchParams.get("search") || "";
		const page = parseInt(request.nextUrl.searchParams.get("page") || "1", 10);

		// ── Browse a custom clone source (retro hotel furnidata) ────────
		const { localIndex, importedSet } = await getLocalCatalogSnapshot();
		const furniDataSet = await getFurniDataClassnames();
		const catalogIdSet = await getCatalogIdSet();
		const sourceId = request.nextUrl.searchParams.get("source");
		if (sourceId) {
			const source = await getSource(sourceId);
			if (!source) return apiError("Source not found", 404);

			const { items, meta } = await getCloneList({
				source,
				search,
				page,
				perPage: 500,
				filter: "all",
			});

			const sourceIconBase = source.iconBaseUrl?.trim().replace(/\/+$/, "");

			const enriched = items.map((item) => {
				const presence = localFurnitureStatus(
					item.classname,
					localIndex,
					furniDataSet,
					catalogIdSet,
				);
				const imported = presence.alreadyImported;
				let nitroExists = false;
				if (imported) {
					const starIdx = item.classname.indexOf("*");
					const base =
						starIdx !== -1
							? item.classname.substring(0, starIdx)
							: item.classname;
					nitroExists =
						nitroExistsCached(nitroDir, base) ||
						(localIndex.get(normalizeClassname(item.classname)) ?? []).some(
							(row) => nitroExistsCached(nitroDir, row.itemName.split("*")[0]),
						);
				}
				return {
					id: item.id,
					classname: item.classname,
					type: item.itemType === "i" ? "wallitem" : "flooritem",
					name: item.name,
					description: item.description,
					revision: Number(item.revision) || 0,
					category: String(item.category ?? ""),
					...presence,
					nitroExists,

					iconUrl: sourceIconBase
						? `${sourceIconBase}/${encodeURIComponent(item.classname)}_icon.png`
						: undefined,
				};
			});

			return apiOk({
				items: enriched,
				source: { id: source.id, name: source.name },
				meta: {
					currentPage: meta.page,
					lastPage: Math.max(Math.ceil(meta.total / meta.perPage), 1),
					total: meta.total,
					perPage: meta.perPage,
				},
			});
		}

		const result = await listFurniture({
			search: search || undefined,
			page,
			perPage: 500,
			importedSet,
		});

		const enriched = result.items.map((item) => {
			const presence = localFurnitureStatus(
				item.classname,
				localIndex,
				furniDataSet,
				catalogIdSet,
			);
			const imported = presence.alreadyImported;
			let nitroExists = false;
			if (imported) {
				const starIdx = item.classname.indexOf("*");
				const base =
					starIdx !== -1
						? item.classname.substring(0, starIdx)
						: item.classname;
				nitroExists =
					nitroExistsCached(nitroDir, base) ||
					(localIndex.get(normalizeClassname(item.classname)) ?? []).some(
						(row) => nitroExistsCached(nitroDir, row.itemName.split("*")[0]),
					);
			}
			return {
				...item,
				...presence,
				nitroExists,
			};
		});

		return apiOk({ items: enriched, meta: result.meta });
	},
);

// ── Import furni (single or batch) ──────────────────────────────────
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();

		await ensureDirectories();

		// ── Batch import ─────────────────────────────────────────────────
		if (Array.isArray(body.items)) {
			const { sourceId } = body as { sourceId?: string };
			let source: Awaited<ReturnType<typeof getSource>> | null = null;
			if (sourceId) source = await getSource(sourceId);

			type BatchResultItem = ImportSingleResult & { classname: string };

			const runOne = async (
				item: (typeof body.items)[number],
			): Promise<BatchResultItem> => {
				if (!item.classname || !item.name) {
					return {
						classname: item.classname || "unknown",
						ok: false,
						warnings: [],
						error: "Missing classname or name",
					};
				}

				try {
					const result = await importSingleFurni({
						id: item.id ?? 0,
						classname: item.classname,
						name: item.name,
						description: item.description ?? "",
						type: item.type ?? "flooritem",
						revision: item.revision ?? 0,
						category: item.category ?? "unknown",
						updateExisting: body.updateExisting === true,
						sourceSwfBaseUrl: source?.sourceSwfBaseUrl,
						nitroBaseUrl: source?.nitroBaseUrl || undefined,
						iconBaseUrl: source?.iconBaseUrl || undefined,
						skipFurniDataWrite: false,
						repairExisting: body.repairExisting === true,
					});

					if (result.ok) {
						logAudit({
							userId: ctx.session.user.id,
							action: "furni_import",
							target: "ItemsBase",
							targetId: result.itemId ?? 0,
							after: {
								classname: item.classname,
								name: item.name,
								type: item.type === "wallitem" ? "i" : "s",
								catalogItemId: result.catalogItemId,
								dimensions: result.dimensions,
								batch: true,
								warnings:
									result.warnings.length > 0 ? result.warnings : undefined,
							},
						});
					}
					return { classname: item.classname, ...result };
				} catch (err) {
					return {
						classname: item.classname,
						ok: false,
						warnings: [],
						error: (err as Error).message,
					};
				}
			};

			const results = await runWithConcurrency<
				(typeof body.items)[number],
				BatchResultItem
			>(body.items, IMPORT_BATCH_CONCURRENCY, runOne);

			// Collect FurnitureData entries and write the whole file once for the
			// batch instead of once per item (each per-item write rewrites it fully).
			const collectedFurniEntries: Array<{
				entry: Record<string, unknown>;
				itemType: string;
			}> = [];
			for (const r of results) {
				if (r.furniDataEntry) collectedFurniEntries.push(r.furniDataEntry);
			}
			if (collectedFurniEntries.length > 0) {
				try {
					await appendFurniEntriesBulk(collectedFurniEntries);
				} catch (err) {
					logger.warn(
						`[import-furni] Bulk FurnitureData.json write failed: ${(err as Error).message}`,
					);
				}
			}

			// Refresh caches once after batch
			try {
				await rcon.updateCatalog();
				await rcon.updateItems();
			} catch (err) {
				logger.warn(
					`[import-furni] RCON update failed after batch: ${(err as Error).message}`,
				);
			}
			invalidateCatalogTotals();

			// Force offer_id to mirror its catalog row id across the tree
			const reconciled = await reconcileImportedOfferIds();

			// Keep asset + furnidata folders readable by the web server
			const ownership = await ensureFurniOwnership();

			// Backfill any missing nitros into the emulator's Gamedata bundle
			const assetsSynced = await syncAssetsToGamedataBundle();

			// Verify the furnidata matches the DB ids
			const furniReconcile = await reconcileFurniDataWithItemsBase();

			// Force every catalog offer_id to equal its own row id
			const offerRebuild = await rebuildCatalogOfferIds();

			// Repair any sprite_id drift so the client renders the right item
			const spriteVerify = await verifyAndFixSpriteIds();

			// Verify + fix interaction_modes_count once for the whole batch
			const verification = await verifyAndFixInteractionModesCount();

			// Fix database consistency (catalog_name + have_offer + cost_credits) after import
			const { catalogNameFixed, haveOfferFixed, costCreditsFixed } =
				await fixDatabaseConsistencyAfterImport();

			// Rebuild localized furnidata files (best effort). `translate: false`
			// skips entirely; `translate: true` forces a build even when the global
			// setting is off; undefined falls back to the global setting. An optional
			// `langs` array restricts which languages are rebuilt.
			let languages: Awaited<ReturnType<typeof buildLocalizedFurniDataFiles>> =
				[];
			try {
				if (body.translate !== false) {
					const langs = Array.isArray(body.langs)
						? (body.langs as unknown[]).filter(
								(l): l is string => typeof l === "string",
							)
						: undefined;
					languages = await buildLocalizedFurniDataFiles(
						body.translate === true,
						langs,
					);
				}
			} catch (err) {
				logger.warn(
					`[import-furni] Localized furnidata build failed: ${(err as Error).message}`,
				);
			}

			const succeeded = results.filter((r) => r.ok).length;
			const failed = results.filter((r) => !r.ok).length;

			// New items + files landed — drop caches so the next Studio load is fresh.
			clearFurniImportCache();

			return apiOk({
				batch: true,
				succeeded,
				failed,
				results,
				offerIdsFixed: reconciled.fixed,
				ownershipFixed: ownership.fixed,
				nitrosSynced: assetsSynced.copiedNitros,
				iconsSynced: assetsSynced.copiedIcons,
				furniDataFixedIds: furniReconcile.fixedIds,
				furniDataFixedOfferIds: furniReconcile.fixedOfferIds,
				furniDataMissing: furniReconcile.missing,
				furniDataConflicts: furniReconcile.conflicts,
				offerRebuildChecked: offerRebuild.checked,
				offerRebuildFixed: offerRebuild.fixed,
				spriteChecked: spriteVerify.checked,
				spriteFixed: spriteVerify.fixed,
				interactionFixed: verification.fixed,
				catalogNameFixed,
				haveOfferFixed,
				costCreditsFixed,
				languages,
			});
		}

		const runSingle = async () => {
			// ── Single import ────────────────────────────────────────────────
			const {
				id,
				classname,
				name,
				description,
				type,
				revision,
				category,
				sourceId,
				updateExisting,
			} = body;

			if (!classname || !name)
				return apiError("Missing classname or name", 400);

			let source: Awaited<ReturnType<typeof getSource>> | null = null;
			if (sourceId) source = await getSource(sourceId);

			const result = await importSingleFurni({
				id: id ?? 0,
				classname,
				name,
				description: description ?? "",
				type: type ?? "flooritem",
				revision: revision ?? 0,
				category: category ?? "unknown",
				updateExisting: updateExisting === true,
				repairExisting: body.repairExisting === true,
				sourceSwfBaseUrl: source?.sourceSwfBaseUrl,
				nitroBaseUrl: source?.nitroBaseUrl || undefined,
				iconBaseUrl: source?.iconBaseUrl || undefined,
			});

			if (!result.ok) return apiError(result.error ?? "Import failed", 409);

			// Refresh game server caches
			try {
				await rcon.updateCatalog();
				await rcon.updateItems();
			} catch (err) {
				logger.warn(
					`[import-furni] RCON update failed: ${(err as Error).message}`,
				);
				result.warnings.push("RCON cache refresh failed");
			}
			invalidateCatalogTotals();

			// Force offer_id to mirror its catalog row id across the tree
			const reconciled = await reconcileImportedOfferIds();

			// Keep asset + furnidata folders readable by the web server
			const ownership = await ensureFurniOwnership();

			// Backfill any missing nitros and icons into the emulator's Gamedata bundle
			const assetsSynced = await syncAssetsToGamedataBundle();

			// Verify the furnidata matches the DB ids
			const furniReconcile = await reconcileFurniDataWithItemsBase();

			// Fix database consistency (catalog_name + have_offer + cost_credits) after import
			const { catalogNameFixed, haveOfferFixed, costCreditsFixed } =
				await fixDatabaseConsistencyAfterImport();

			// Force every catalog offer_id to equal its own row id
			const offerRebuild = await rebuildCatalogOfferIds();

			// Repair any sprite_id drift so the client renders the right item
			const spriteVerify = await verifyAndFixSpriteIds();

			// Verify + fix interaction_modes_count (single consolidated pass)
			const verification = await verifyAndFixInteractionModesCount();

			// Patch localized furnidata files for this single furni (best effort).
			// Same `translate` / `langs` contract as the batch path above.
			let languagesPatch: Awaited<
				ReturnType<typeof patchLocalizedFurniDataEntries>
			> = [];
			try {
				if (body.translate !== false) {
					const langs = Array.isArray(body.langs)
						? (body.langs as unknown[]).filter(
								(l): l is string => typeof l === "string",
							)
						: undefined;
					languagesPatch = await patchLocalizedFurniDataEntries(
						[{ classname, name, description: description ?? "" }],
						body.translate === true,
						langs,
					);
				}
			} catch (err) {
				logger.warn(
					`[import-furni] Localized patch failed: ${(err as Error).message}`,
				);
			}

			logAudit({
				userId: ctx.session.user.id,
				action: "furni_import",
				target: "ItemsBase",
				targetId: result.itemId ?? 0,
				after: {
					classname,
					name,
					spriteId: id ?? 0,
					type: type === "wallitem" ? "i" : "s",
					catalogItemId: result.catalogItemId,
					dimensions: result.dimensions,
					spriteCount: result.spriteCount,
					warnings: result.warnings.length > 0 ? result.warnings : undefined,
				},
			});

			clearFurniImportCache();

			return apiOk({
				id: result.itemId,
				catalogItemId: result.catalogItemId,
				offerIdsFixed: reconciled.fixed,
				ownershipFixed: ownership.fixed,
				nitrosSynced: assetsSynced.copiedNitros,
				iconsSynced: assetsSynced.copiedIcons,
				furniDataFixedIds: furniReconcile.fixedIds,
				furniDataFixedOfferIds: furniReconcile.fixedOfferIds,
				furniDataMissing: furniReconcile.missing,
				furniDataFixedConflicts: furniReconcile.fixedConflicts,
				furniDataConflicts: furniReconcile.conflicts,
				offerRebuildChecked: offerRebuild.checked,
				offerRebuildFixed: offerRebuild.fixed,
				spriteChecked: spriteVerify.checked,
				spriteFixed: spriteVerify.fixed,
				interactionFixed: verification.fixed,
				catalogNameFixed,
				haveOfferFixed,
				costCreditsFixed,
				languages: languagesPatch,
				spriteCount: result.spriteCount,
				warnings: result.warnings,
			});
		};
		return request.headers.get("accept")?.includes("text/event-stream")
			? streamImportResponse(runSingle)
			: runSingle();
	},
);

// ── Re-generate missing .nitro files (PATCH) ─────────────────────────
export const PATCH = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const body = await request.json();
		const items: Array<{ classname: string; revision: number }> =
			body.items || [];

		if (items.length === 0) return apiError("No items provided", 400);

		await ensureDirectories();
		const { swfDir, nitroDir } = await getFurniAssetDirs();

		const results: Array<{ classname: string; ok: boolean; warning?: string }> =
			[];

		for (const item of items) {
			const normalised = item.classname.trim();
			// The classname is joined straight into a `.nitro` file path, so a
			// separator/looking payload must never get that far.
			if (!isSafeAssetName(normalised)) {
				results.push({
					classname: item.classname,
					ok: false,
					warning: "Invalid classname",
				});
				continue;
			}
			const starIdx = normalised.indexOf("*");
			const baseClassname =
				starIdx !== -1 ? normalised.substring(0, starIdx) : normalised;
			// Regeneration writes `.hab`; a legacy `.nitro` counts as present too.
			const nitroPath = bundleWritePathInDir(
				/*turbopackIgnore: true*/ nitroDir,
				baseClassname,
			);

			// Skip if a bundle already exists (`.hab` or legacy `.nitro`).
			if (
				bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, baseClassname)
			) {
				results.push({
					classname: item.classname,
					ok: true,
					warning: "Already exists",
				});
				continue;
			}

			// Resolve revision: try furnidata first, then spriteId as fallback
			let rev = item.revision || 0;
			if (rev === 0) {
				const furnidata = await getOfficialHabboFurnidata();
				const fd =
					furnidata.get(item.classname) ||
					furnidata.get(baseClassname) ||
					furnidata.get(`${baseClassname}*0`);
				if (fd) rev = fd.revision;
			}

			const swfPath = path.join(swfDir, `${baseClassname}.swf`);

			// Download SWF if not present — try multiple revision candidates
			if (!existsSync(swfPath)) {
				// Build list of revisions to try: known rev, spriteId, common fallbacks
				const [spriteId] = await db
					.select({ spriteId: ItemsBase.spriteId })
					.from(ItemsBase)
					.where(eq(ItemsBase.itemName, item.classname))
					.limit(1);
				const revsToTry = [
					...new Set([rev, spriteId?.spriteId || 0].filter((r) => r > 0)),
				];

				let downloaded = false;
				for (const tryRev of revsToTry) {
					const dl = await downloadFile(
						`https://images.habbo.com/dcr/hof_furni/${tryRev}/${encodeURIComponent(baseClassname)}.swf`,
						swfPath,
						{ validate: "swf" },
					);
					if (dl.ok) {
						rev = tryRev;
						downloaded = true;
						break;
					}
				}

				if (!downloaded) {
					results.push({
						classname: item.classname,
						ok: false,
						warning: `SWF not found on Habbo CDN (tried revisions: ${revsToTry.join(", ") || "none"})`,
					});
					continue;
				}
			}

			// Convert SWF → Nitro + update FurnitureData.json
			try {
				const swfBuffer = await fs.readFile(swfPath);
				const conversion = await convertSwfToNitro(swfBuffer, baseClassname);
				await fs.writeFile(nitroPath, conversion.bundle);

				// Add to FurnitureData.json if not already present
				try {
					const { buildFurniEntry, appendFurniEntry, readFurniData } =
						await import("@/lib/services/furni-data");
					const furniData = (await readFurniData()) as {
						roomitemtypes?: { furnitype?: Array<{ classname?: string }> };
						wallitemtypes?: { furnitype?: Array<{ classname?: string }> };
					};

					// Check if already in FurnitureData
					const allEntries = [
						...(furniData.roomitemtypes?.furnitype || []),
						...(furniData.wallitemtypes?.furnitype || []),
					];
					const alreadyInFD = allEntries.some(
						(e) =>
							e.classname === baseClassname || e.classname === item.classname,
					);

					if (!alreadyInFD) {
						const [dbItem] = await db
							.select({
								id: ItemsBase.id,
								spriteId: ItemsBase.spriteId,
								publicName: ItemsBase.publicName,
								type: ItemsBase.type,
							})
							.from(ItemsBase)
							.where(eq(ItemsBase.itemName, item.classname))
							.limit(1);
						const furnidata = await getOfficialHabboFurnidata();
						const fd =
							furnidata.get(item.classname) || furnidata.get(baseClassname);
						const itemType = dbItem?.type === "i" ? "i" : "s";

						const entry = buildFurniEntry({
							id: dbItem?.spriteId || 0,
							classname: baseClassname,
							revision: rev,
							category: fd?.category || "",
							name: dbItem?.publicName || baseClassname,
							description: fd?.description || "",
							spriteId: dbItem?.spriteId || 0,
							dims: conversion.dimensions || { x: 1, y: 1, z: 1 },
							metadata: conversion.metadata || null,
							officialHabbo: fd || null,
						});
						await appendFurniEntry(entry, itemType);
					}
				} catch (fdErr) {
					logger.warn(
						`[regen] FurnitureData update skipped for ${item.classname}: ${(fdErr as Error).message}`,
					);
				}

				results.push({ classname: item.classname, ok: true });
			} catch (err) {
				results.push({
					classname: item.classname,
					ok: false,
					warning: (err as Error).message,
				});
			}
			await new Promise((r) => setImmediate(r));
		}

		const succeeded = results.filter((r) => r.ok).length;
		const failed = results.filter((r) => !r.ok).length;

		// New .nitro files were written — drop the presence cache.
		clearFurniImportCache();

		return apiOk({ succeeded, failed, results });
	},
);
