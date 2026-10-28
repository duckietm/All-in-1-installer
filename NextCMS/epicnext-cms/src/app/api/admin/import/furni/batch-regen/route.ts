import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase } from "@/lib/db";
import {
	bundleExistsInDir,
	bundleWritePathInDir,
} from "@/lib/furni/bundle-file";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import {
	appendFurniEntriesBatch,
	buildFurniEntry,
	readFurniData,
	rebuildCatalogOfferIds,
	reconcileFurniDataWithItemsBase,
	verifyAndFixSpriteIds,
} from "@/lib/services/furni-data";
import { buildLocalizedFurniDataFiles } from "@/lib/services/furni-data-i18n";
import {
	downloadFile,
	ensureDirectories,
	ensureFurniOwnership,
	syncAssetsToGamedataBundle,
} from "@/lib/services/furni-import";
import { getOfficialHabboFurnidata } from "@/lib/services/habbo-furnidata-cache";
import { rcon } from "@/lib/services/rcon";
import { convertSwfToNitro } from "@/lib/services/swf-to-nitro";

interface RegenItem {
	classname: string;
	revision: number;
}

/**
 * SSE batch regenerate .nitro files.
 * Streams progress events for each item.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const body = await request.json();
		const items: RegenItem[] = body.items || [];
		const concurrency = Math.min(Math.max(body.concurrency || 1, 1), 3);

		if (items.length === 0) return apiError("No items to regenerate", 400);

		await ensureDirectories();
		const { swfDir, nitroDir } = await getFurniAssetDirs();
		const encoder = new TextEncoder();

		// Wire client disconnect to abort controller
		let aborted = false;
		request.signal.addEventListener("abort", () => {
			aborted = true;
		});

		const stream = new ReadableStream({
			async start(controller) {
				const send = (data: unknown) => {
					if (aborted) return;
					try {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
						);
					} catch {
						/* stream closed */
					}
				};

				const startTime = Date.now();
				send({ type: "regen_start", total: items.length });

				let succeeded = 0;
				let failed = 0;
				let skipped = 0;
				const furniDataEntries: Array<{
					entry: Record<string, unknown>;
					itemType: string;
				}> = [];

				// Load furnidata once for all items
				const furnidata = await getOfficialHabboFurnidata();

				// Load existing FurnitureData.json classnames for dedup
				const existingFD = (await readFurniData()) as {
					roomitemtypes?: { furnitype?: Array<{ classname?: string }> };
					wallitemtypes?: { furnitype?: Array<{ classname?: string }> };
				};
				const fdClassnames = new Set([
					...(existingFD.roomitemtypes?.furnitype || []).map(
						(e) => e.classname,
					),
					...(existingFD.wallitemtypes?.furnitype || []).map(
						(e) => e.classname,
					),
				]);

				for (let i = 0; i < items.length; i += concurrency) {
					const chunk = items.slice(i, i + concurrency);

					const promises = chunk.map(async (item) => {
						const starIdx = item.classname.indexOf("*");
						const baseClassname =
							starIdx !== -1
								? item.classname.substring(0, starIdx)
								: item.classname;
						if (
							bundleExistsInDir(
								/*turbopackIgnore: true*/ nitroDir,
								baseClassname,
							)
						) {
							skipped++;
							send({
								type: "regen_progress",
								classname: item.classname,
								status: "skipped",
							});
							return;
						}

						send({
							type: "regen_progress",
							classname: item.classname,
							status: "downloading",
						});

						// Resolve revision
						let rev = item.revision || 0;
						if (rev === 0) {
							const fd =
								furnidata.get(item.classname) ||
								furnidata.get(baseClassname) ||
								furnidata.get(`${baseClassname}*0`);
							if (fd) rev = fd.revision;
						}

						// Try spriteId as fallback revision
						const revsToTry: number[] = [];
						if (rev > 0) revsToTry.push(rev);
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
						if (dbItem?.spriteId && !revsToTry.includes(dbItem.spriteId)) {
							revsToTry.push(dbItem.spriteId);
						}

						if (revsToTry.length === 0) {
							failed++;
							send({
								type: "regen_progress",
								classname: item.classname,
								status: "failed",
								message: "No revision found",
							});
							return;
						}

						const swfPath = path.join(swfDir, `${baseClassname}.swf`);

						// Download SWF if needed
						if (!existsSync(swfPath)) {
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
								failed++;
								send({
									type: "regen_progress",
									classname: item.classname,
									status: "failed",
									message: `SWF not found (revs: ${revsToTry.join(", ")})`,
								});
								return;
							}
						}

						// Convert
						send({
							type: "regen_progress",
							classname: item.classname,
							status: "converting",
						});
						try {
							const swfBuffer = await fs.readFile(swfPath);
							const conversion = await convertSwfToNitro(
								swfBuffer,
								baseClassname,
							);
							const nitroPath = bundleWritePathInDir(
								/*turbopackIgnore: true*/ nitroDir,
								baseClassname,
							);
							await fs.writeFile(nitroPath, conversion.bundle);

							// Build FurnitureData entry if missing
							if (
								!fdClassnames.has(baseClassname) &&
								!fdClassnames.has(item.classname)
							) {
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
								furniDataEntries.push({ entry, itemType });
								fdClassnames.add(baseClassname);
							}

							succeeded++;
							send({
								type: "regen_progress",
								classname: item.classname,
								status: "done",
							});
						} catch (err) {
							failed++;
							send({
								type: "regen_progress",
								classname: item.classname,
								status: "failed",
								message: (err as Error).message,
							});
						}
					});

					await Promise.allSettled(promises);
					await new Promise((r) => setImmediate(r));
				}

				if (aborted) {
					send({
						type: "regen_complete",
						succeeded,
						failed,
						skipped,
						aborted: true,
					});
					controller.close();
					return;
				}

				// Batch write FurnitureData.json
				if (furniDataEntries.length > 0) {
					try {
						await appendFurniEntriesBatch(furniDataEntries);
						send({
							type: "regen_info",
							message: `Added ${furniDataEntries.length} entries to FurnitureData.json`,
						});
					} catch (err) {
						send({
							type: "regen_info",
							message: `FurnitureData.json write failed: ${(err as Error).message}`,
						});
					}
				}

				// RCON refresh
				try {
					await rcon.updateItems();
					await rcon.updateCatalog();
				} catch {
					/* non-fatal */
				}

				// Keep regenerated assets readable by the web server
				const ownership = await ensureFurniOwnership();

				// Backfill any missing nitros and icons into the emulator's Gamedata bundle
				const assetsSynced = await syncAssetsToGamedataBundle();

				// Verify the furnidata matches the DB ids
				const furniReconcile = await reconcileFurniDataWithItemsBase();

				// Force every catalog offer_id to equal its own row id
				const offerRebuild = await rebuildCatalogOfferIds();

				// Repair any sprite_id drift so the client renders the right item
				const spriteVerify = await verifyAndFixSpriteIds();

				let languages: Awaited<
					ReturnType<typeof buildLocalizedFurniDataFiles>
				> = [];
				try {
					languages = await buildLocalizedFurniDataFiles();
				} catch (err) {
					logger.warn(
						`[batch-regen] Localized furnidata build failed: ${(err as Error).message}`,
					);
				}

				if (!aborted) {
					send({
						type: "regen_complete",
						succeeded,
						failed,
						skipped,
						furniDataAdded: furniDataEntries.length,
						ownershipFixed: ownership.fixed,
						nitrosSynced: assetsSynced.copiedNitros,
						iconsSynced: assetsSynced.copiedIcons,
						furniDataFixedIds: furniReconcile.fixedIds,
						furniDataMissing: furniReconcile.missing,
						furniDataConflicts: furniReconcile.conflicts,
						offerRebuildChecked: offerRebuild.checked,
						offerRebuildFixed: offerRebuild.fixed,
						spriteChecked: spriteVerify.checked,
						spriteFixed: spriteVerify.fixed,
						languages,
						duration: Date.now() - startTime,
					});
				}

				controller.close();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Accel-Buffering": "no",
				Connection: "keep-alive",
			},
		});
	},
);
