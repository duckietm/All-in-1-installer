import { randomUUID } from "node:crypto";
import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { getRequestId } from "@/lib/foundation/request-context";
import type { ImportJob } from "@/lib/furni/import-job";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { getSource } from "@/lib/services/clone-sources";
import {
	appendFurniEntriesBatch,
	rebuildCatalogOfferIds,
	reconcileFurniDataWithItemsBase,
	verifyAndFixSpriteIds,
} from "@/lib/services/furni-data";
import {
	buildLocalizedFurniDataFiles,
	patchLocalizedFurniDataEntries,
} from "@/lib/services/furni-data-i18n";
import {
	ensureDirectories,
	ensureFurniOwnership,
	fixDatabaseConsistencyAfterImport,
	importSingleFurni,
	reconcileImportedOfferIds,
	syncAssetsToGamedataBundle,
	verifyAndFixInteractionModesCount,
} from "@/lib/services/furni-import";
import { clearFurniImportCache } from "@/lib/services/furni-import-cache";
import { ImportJobStore } from "@/lib/services/furni-job-store";
import { withTransientImportRetry } from "@/lib/services/import/transient-retry";
import { rcon } from "@/lib/services/rcon";
import type { ImportSingleResult } from "@/types/furni";

interface BatchItem {
	id: number;
	classname: string;
	name: string;
	description: string;
	type: string;
	revision: number;
	category: string;
}

/**
 * SSE batch import endpoint.
 * Processes multiple furniture items with configurable concurrency,
 * streaming real-time progress events to the client.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const body = await request.json();
		const rawItems: BatchItem[] = body.items || [];
		const concurrency = Math.min(Math.max(body.concurrency || 3, 1), 12);
		const sourceId: string | undefined = body.sourceId;

		if (rawItems.length === 0) return apiError("No items to import", 400);

		// Look up clone source for SWF/nitro/icon URL fallbacks
		let source: Awaited<ReturnType<typeof getSource>> | null = null;
		if (sourceId) {
			source = await getSource(sourceId);
		}

		// Deduplicate by (spriteId, classname) to avoid concurrent INSERT races on
		// items_base.id when the same item is listed twice in the request body.
		const seen = new Set<string>();
		const items: BatchItem[] = [];
		for (const it of rawItems) {
			const key = `${it.id}:${it.classname}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push(it);
		}

		await ensureDirectories();
		const encoder = new TextEncoder();

		// Durable checkpoint: mirror this run into the import-job store so an
		// interrupted batch can be resumed from Import History after a restart,
		// time-out or disconnect. The job starts "running" so the boot-time
		// worker drain marks it "interrupted" instead of double-importing.
		const store = new ImportJobStore();
		const createdAt = new Date().toISOString();
		const mirrorJob: ImportJob | null = await (async () => {
			try {
				const job: ImportJob = {
					id: randomUUID(),
					userId: ctx.session.user.id,
					operationId: getRequestId(),
					createdAt,
					updatedAt: createdAt,
					state: "running",
					sourceId,
					translate: body.translate === true,
					langs:
						Array.isArray(body.langs) && body.langs.length > 0
							? body.langs
							: undefined,
					items: items.map((item) => ({
						id: item.id ?? 0,
						classname: item.classname,
						name: item.name,
						description: item.description ?? "",
						type: item.type === "wallitem" ? "wallitem" : "flooritem",
						revision: item.revision ?? 0,
						category: item.category ?? "unknown",
						state: "pending",
					})),
				};
				await store.save(job);
				return job;
			} catch (error) {
				logger.warn("[import-furni] Could not create durable batch job", {
					err: error as Error,
				});
				return null;
			}
		})();

		// Wire client disconnect to abort controller so we stop processing
		// when the user navigates away or closes the browser.
		const abortController = new AbortController();
		let aborted = false;
		request.signal.addEventListener("abort", () => {
			aborted = true;
			abortController.abort();
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
						/* stream closed by client */
					}
				};

				// Checkpoint writes are coalesced and chained so concurrent item
				// settles can't interleave saves on the same job file; the final
				// state is always flushed by finalizeMirror.
				const mirrorEntry = (classname: string) =>
					mirrorJob?.items.find((m) => m.classname === classname);
				let saveChain: Promise<void> = Promise.resolve();
				let saveQueued = false;
				const checkpoint = () => {
					if (!mirrorJob || saveQueued) return;
					saveQueued = true;
					saveChain = saveChain.then(async () => {
						try {
							await store.save(mirrorJob);
						} catch (error) {
							logger.warn("[import-furni] Checkpoint write failed", {
								err: error as Error,
							});
						} finally {
							saveQueued = false;
						}
					});
				};
				const finalizeMirror = async (state: "completed" | "interrupted") => {
					if (!mirrorJob) return;
					if (state === "interrupted")
						for (const entry of mirrorJob.items)
							if (entry.state === "running") {
								entry.state = "interrupted";
								entry.error =
									"Import stream was interrupted before finishing. Check imported data before resuming it from history.";
							}
					mirrorJob.state = state;
					mirrorJob.updatedAt = new Date().toISOString();
					await saveChain;
					try {
						await store.save(mirrorJob);
					} catch (error) {
						logger.warn("[import-furni] Final checkpoint write failed", {
							err: error as Error,
						});
					}
				};

				const startTime = Date.now();
				send({ type: "batch_start", total: items.length, concurrency });

				let succeeded = 0;
				let failed = 0;
				let withWarnings = 0;
				const furniDataEntries: Array<{
					entry: Record<string, unknown>;
					itemType: string;
				}> = [];

				// Process in chunks of `concurrency`
				for (let i = 0; i < items.length; i += concurrency) {
					if (aborted) break;

					const chunk = items.slice(i, i + concurrency);

					const promises = chunk.map(async (item, chunkIdx) => {
						const index = i + chunkIdx;
						send({
							type: "item_progress",
							classname: item.classname,
							status: "started",
							index,
						});

						const entry = mirrorEntry(item.classname);
						if (entry) {
							entry.state = "running";
							checkpoint();
						}

						try {
							// Coalesce micro-step progress events to at most one per
							// ~120ms per item so large imports don't flood the client
							// (terminal states are always emitted by importSingleFurni
							// and sent below).
							let lastProgressSent = 0;
							const result: ImportSingleResult = await withTransientImportRetry(
								() =>
									importSingleFurni({
										id: item.id ?? 0,
										classname: item.classname,
										name: item.name,
										description: item.description ?? "",
										type: item.type ?? "flooritem",
										revision: item.revision ?? 0,
										category: item.category ?? "unknown",
										skipFurniDataWrite: false,
										repairExisting: body.repairExisting === true,
										sourceSwfBaseUrl: source?.sourceSwfBaseUrl,
										nitroBaseUrl: source?.nitroBaseUrl,
										iconBaseUrl: source?.iconBaseUrl,
										onProgress: (status: string) => {
											const now = Date.now();
											if (now - lastProgressSent < 120) return;
											lastProgressSent = now;
											send({
												type: "item_progress",
												classname: item.classname,
												status,
												index,
											});
										},
									}),
								2,
							);

							if (result.ok) {
								succeeded++;
								const warnings = [...result.warnings];
								if (result.furniDataEntry)
									furniDataEntries.push(result.furniDataEntry);

								// Translation is best-effort, same as the queue worker:
								// a failure warns but never fails the import.
								if (body.translate === true) {
									try {
										send({
											type: "item_progress",
											classname: item.classname,
											status: "translating",
											index,
										});
										await patchLocalizedFurniDataEntries(
											[
												{
													classname: item.classname,
													name: item.name,
													description: item.description,
												},
											],
											true,
											Array.isArray(body.langs) && body.langs.length > 0
												? body.langs
												: undefined,
										);
									} catch {
										warnings.push(
											"Translation failed; furniture imported successfully",
										);
									}
								}

								if (warnings.length > 0) withWarnings++;

								if (entry) {
									entry.state = "done";
									entry.itemId = result.itemId;
									entry.warnings = warnings.length > 0 ? warnings : undefined;
									checkpoint();
								}

								send({
									type: "item_progress",
									classname: item.classname,
									status: "done",
									index,
									itemId: result.itemId,
									warnings: warnings.length > 0 ? warnings : undefined,
								});

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
									},
								});
							} else {
								failed++;
								if (entry) {
									entry.state = "failed";
									entry.error = result.error;
									checkpoint();
								}
								send({
									type: "item_progress",
									classname: item.classname,
									status: "failed",
									index,
									message: result.error,
								});
							}
						} catch (err) {
							failed++;
							if (entry) {
								entry.state = "failed";
								entry.error = (err as Error).message;
								checkpoint();
							}
							send({
								type: "item_progress",
								classname: item.classname,
								status: "failed",
								index,
								message: (err as Error).message,
							});
						}
					});

					await Promise.allSettled(promises);
					await new Promise((r) => setImmediate(r));
				}

				if (succeeded > 0) {
					// New items + files landed — drop caches so the Studio refresh is fresh.
					clearFurniImportCache();
				}

				if (aborted) {
					await finalizeMirror("interrupted");
					send({
						type: "batch_complete",
						succeeded,
						failed,
						warnings: withWarnings,
						aborted: true,
						duration: Date.now() - startTime,
					});
					controller.close();
					return;
				}

				// Post-import steps: send progress so the user knows what's happening
				send({ type: "post_import", status: "Writing FurnitureData.json..." });

				// Batch write FurnitureData.json once at the end — BEFORE RCON so the
				// emulator never sees items that the Nitro client can't render.
				let furniDataWriteOk = true;
				if (furniDataEntries.length > 0) {
					try {
						await appendFurniEntriesBatch(furniDataEntries);
					} catch (err) {
						furniDataWriteOk = false;
						send({
							type: "item_progress",
							classname: "_batch_",
							status: "failed",
							index: -1,
							message: `FurnitureData.json batch write failed: ${(err as Error).message}`,
						});
					}
				}

				// Refresh game server caches once — skip if FurnitureData write failed
				if (furniDataWriteOk && !aborted) {
					send({
						type: "post_import",
						status: "Refreshing emulator caches...",
					});
					try {
						const okCat = await rcon.updateCatalog();
						const okItems = await rcon.updateItems();
						if (!okCat || !okItems) {
							send({
								type: "item_progress",
								classname: "_rcon_",
								status: "failed",
								index: -1,
								message: "RCON refresh failed — emulator cache may be stale",
							});
						}
					} catch (err) {
						logger.warn(
							`[import-furni] RCON update failed after batch: ${(err as Error).message}`,
						);
					}
				}
				// The batch wrote offers and category pages whatever the emulator
				// refresh did; the admin totals must not serve pre-batch numbers.
				invalidateCatalogTotals();

				if (!aborted) {
					send({
						type: "post_import",
						status: "Reconciling offer IDs & ownership...",
					});

					// Post-import reconciliation — wrapped in try/catch so one
					// failure doesn't block the rest.
					let offerIdsFixed = 0;
					let ownershipFixed: string[] = [];
					let nitrosSynced: string[] = [];
					let iconsSynced: string[] = [];
					let furniDataFixedIds = 0;
					let furniDataFixedOfferIds = 0;
					let furniDataMissing = 0;
					let furniDataConflicts = 0;
					let offerRebuildFixed = 0;
					let spriteFixed = 0;
					let interactionFixed = 0;
					let languages: Awaited<
						ReturnType<typeof buildLocalizedFurniDataFiles>
					> = [];
					try {
						offerIdsFixed = (await reconcileImportedOfferIds()).fixed;
						ownershipFixed = (await ensureFurniOwnership()).fixed;
						const assetsSynced = await syncAssetsToGamedataBundle();
						nitrosSynced = assetsSynced.copiedNitros;
						iconsSynced = assetsSynced.copiedIcons;
						const furniReconcile = await reconcileFurniDataWithItemsBase();
						furniDataFixedIds = furniReconcile.fixedIds;
						furniDataFixedOfferIds = furniReconcile.fixedOfferIds;
						furniDataMissing = furniReconcile.missing;
						furniDataConflicts = furniReconcile.conflicts;
						offerRebuildFixed = (await rebuildCatalogOfferIds()).fixed;
						spriteFixed = (await verifyAndFixSpriteIds()).fixed;

						if (!aborted) {
							send({
								type: "post_import",
								status: "Verifying interaction modes...",
							});
							interactionFixed = (await verifyAndFixInteractionModesCount())
								.fixed;
						}

						try {
							languages = await buildLocalizedFurniDataFiles();
						} catch (err) {
							logger.warn(
								`[import-furni] Localized furnidata build failed: ${(err as Error).message}`,
							);
						}
					} catch (err) {
						logger.warn(
							`[import-furni] Post-import reconcile/ownership failed: ${(err as Error).message}`,
						);
					}

					send({
						type: "post_import",
						status: "Fixing database consistency...",
					});
					const { catalogNameFixed, haveOfferFixed, costCreditsFixed } =
						await fixDatabaseConsistencyAfterImport();

					await finalizeMirror("completed");

					send({
						type: "batch_complete",
						succeeded,
						failed,
						warnings: withWarnings,
						offerIdsFixed,
						ownershipFixed,
						nitrosSynced,
						iconsSynced,
						furniDataFixedIds,
						furniDataFixedOfferIds,
						furniDataMissing,
						furniDataConflicts,
						offerRebuildFixed,
						spriteFixed,
						interactionFixed,
						catalogNameFixed,
						haveOfferFixed,
						costCreditsFixed,
						languages,
						duration: Date.now() - startTime,
					});
				} else {
					await finalizeMirror("interrupted");
					send({
						type: "batch_complete",
						succeeded,
						failed,
						warnings: withWarnings,
						aborted: true,
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
