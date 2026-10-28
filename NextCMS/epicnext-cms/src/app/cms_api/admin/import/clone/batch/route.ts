import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	cloneSingleFurni,
	fetchSourceFurnidata,
} from "@/lib/services/clone-import";
import { getSource } from "@/lib/services/clone-sources";
import {
	appendFurniEntriesBatch,
	appendFurniEntry,
	rebuildCatalogOfferIds,
	reconcileFurniDataWithItemsBase,
	verifyAndFixSpriteIds,
} from "@/lib/services/furni-data";
import { buildLocalizedFurniDataFiles } from "@/lib/services/furni-data-i18n";
import {
	ensureFurniOwnership,
	reconcileImportedOfferIds,
	syncAssetsToGamedataBundle,
	verifyAndFixInteractionModesCount,
} from "@/lib/services/furni-import";
import { clearFurniImportCache } from "@/lib/services/furni-import-cache";
import { runSseBatch } from "@/lib/services/import/core/sse-batch";
import { rcon } from "@/lib/services/rcon";

interface BatchItem {
	classname: string;
}

/** Maximum retries for fetching furnidata before giving up. */
const FURNITDATA_MAX_RETRIES = 3;

/** Base delay between retries (ms). */
const FURNITDATA_RETRY_DELAY = 1_000;

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const sourceId: string = body.sourceId || "";
		const rawClassnames: string[] = body.classnames || [];
		const isFinal = body.final === true;

		if (!sourceId) return apiError("Missing sourceId", 400);
		if (rawClassnames.length === 0)
			return apiError("No classnames to clone", 400);

		const source = await getSource(sourceId);
		if (!source) return apiError("Source not found", 404);

		// Fetch furnidata once so we can resolve entries by classname.
		let allEntries: Awaited<ReturnType<typeof fetchSourceFurnidata>> = [];
		for (let attempt = 1; attempt <= FURNITDATA_MAX_RETRIES; attempt++) {
			try {
				allEntries = await fetchSourceFurnidata(source.furnidataUrl);
				break;
			} catch (err) {
				if (attempt < FURNITDATA_MAX_RETRIES) {
					await new Promise((resolve) =>
						setTimeout(resolve, FURNITDATA_RETRY_DELAY),
					);
					continue;
				}
				return apiError(
					`Failed to fetch furnidata after ${FURNITDATA_MAX_RETRIES} attempts: ${(err as Error).message}`,
					502,
				);
			}
		}

		const entryMap = new Map(allEntries.map((e) => [e.classname, e]));

		// Deduplicate classnames preserving order.
		const seen = new Set<string>();
		const items: BatchItem[] = [];
		for (const cn of rawClassnames) {
			if (!seen.has(cn)) {
				seen.add(cn);
				items.push({ classname: cn });
			}
		}

		if (items.length > 5000)
			return apiError("Too many classnames (max 5000)", 400);

		// FurnitureData entries for successfully cloned items are appended once
		// at the end (single read-modify-write instead of one per item), which
		// removes the main serialization bottleneck when cloning hundreds of items.
		const deferredEntries: Array<{
			entry: Record<string, unknown>;
			itemType: string;
		}> = [];

		return runSseBatch<BatchItem>({
			items,
			concurrency: body.concurrency || 10,
			signal: request.signal,
			labelOf: (it) => it.classname,
			worker: async (it, _index, report) => {
				const entry = entryMap.get(it.classname);
				if (!entry) {
					return {
						ok: false,
						error: "classname not found in source furnidata",
					};
				}

				const result = await cloneSingleFurni({
					source,
					entry,
					onProgress: report,
					deferFurniData: true,
				});

				if (result.ok) {
					if (result.furniDataEntry) {
						deferredEntries.push(result.furniDataEntry);
					}
					logAudit({
						userId: ctx.session.user.id,
						action: "clone_furni",
						target: "FurniAsset",
						targetId: 0,
						after: {
							classname: it.classname,
							sourceId,
							sourceName: source.name,
						},
					});
				}

				return {
					ok: result.ok,
					warnings: result.warnings,
					error: result.error,
				};
			},
			flush: async () => {
				if (deferredEntries.length === 0) return;
				try {
					await appendFurniEntriesBatch(deferredEntries);
				} catch (err) {
					// Fallback so partial data survives: write each entry individually.
					for (const { entry, itemType } of deferredEntries) {
						try {
							await appendFurniEntry(entry, itemType);
						} catch {
							/* best effort */
						}
					}
					throw new Error(
						`FurnitureData batch write failed: ${(err as Error).message}`,
					);
				}

				if (!isFinal) return;

				// Post-import consolidation, mirroring the furni batch route:
				// force offer_id to mirror its catalog row id, keep the
				// FurnitureData in sync with the new local sprite ids, verify
				// interaction_modes_count, and refresh the emulator + asset
				// ownership. Never fails the stream — best effort.
				try {
					await reconcileImportedOfferIds();
					await reconcileFurniDataWithItemsBase();
					await rebuildCatalogOfferIds();
					await verifyAndFixSpriteIds();
					await verifyAndFixInteractionModesCount();
					try {
						await buildLocalizedFurniDataFiles();
					} catch {
						/* localized build failures are non-fatal */
					}
					await ensureFurniOwnership();
					await syncAssetsToGamedataBundle();
					await rcon.updateCatalog();
					await rcon.updateItems();
				} catch {
					/* best effort — post-import consolidation is non-fatal */
				}

				// New items + files landed — drop caches so the Studio refresh is fresh.
				clearFurniImportCache();
				invalidateCatalogTotals();
			},
		});
	},
);
