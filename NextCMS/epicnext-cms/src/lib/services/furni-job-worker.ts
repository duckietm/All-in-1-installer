import { randomUUID } from "node:crypto";
import { invalidateCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { createStore, runWithStore } from "@/lib/foundation/request-context";
import type { IpAddress, RequestId, UserId } from "@/lib/foundation/types";
import { IMPORT_PHASES, type ImportJob } from "@/lib/furni/import-job";
import { redis } from "@/lib/redis";
import { logServerError } from "@/lib/server-log";
import { logAudit } from "./audit";
import { runCatalogExport } from "./catalog-git-export";
import { withCatalogExport } from "./catalog-git-queue";
import { getSource } from "./clone-sources";
import { readFurnitureAttachment } from "./furni-attachment";
import { patchLocalizedFurniDataEntries } from "./furni-data-i18n";
import { ensureDirectories, importSingleFurni } from "./furni-import";
import { ImportJobStore } from "./furni-job-store";
import { runSyncJobItem } from "./furni-sync-item";
import { repairFurniture } from "./furniture-repair";
import { recoverFurnitureNitro } from "./furniture-source-recovery";
import { rcon } from "./rcon";

const LOCK = "furniture-import-worker:v1";
class ImportLeaseLostError extends Error {}
let running: Promise<void> | undefined;
export function drainFurnitureImports(): Promise<void> {
	if (running) return running;
	running = drain()
		.catch((error) => {
			logServerError("furni.worker_failed", error);
		})
		.finally(() => {
			running = undefined;
		});
	return running;
}
async function drain() {
	if (!redis) return;
	const token = randomUUID();
	if ((await redis.set(LOCK, token, "EX", 600, "NX")) !== "OK") return;
	let lease = true;
	async function requireLease() {
		if (!lease) throw new ImportLeaseLostError("Import worker lost its lease");
		try {
			const owned = await redis?.eval(
				"if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],600) else return 0 end",
				1,
				LOCK,
				token,
			);
			if (owned !== 1 || !lease) {
				lease = false;
				throw new ImportLeaseLostError("Import worker lost its lease");
			}
		} catch (error) {
			lease = false;
			if (error instanceof ImportLeaseLostError) throw error;
			throw new ImportLeaseLostError(
				"Import worker could not verify its lease",
				{ cause: error },
			);
		}
	}
	const timer = setInterval(() => {
		void redis
			?.eval(
				"if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],600) else return 0 end",
				1,
				LOCK,
				token,
			)
			.then((result) => {
				if (result !== 1) lease = false;
			})
			.catch(() => {
				lease = false;
			});
	}, 30000);
	try {
		const store = new ImportJobStore();
		// Redis ownership checks and file writes are separate operations. These checks
		// prevent known stale writes; they do not provide atomic filesystem fencing.
		async function saveOwned(job: ImportJob) {
			await requireLease();
			await store.save(job);
		}
		for (const job of await store.list()) {
			await requireLease();
			if (job.state === "running") {
				job.state = "interrupted";
				for (const item of job.items)
					if (item.state === "running") {
						item.state = "interrupted";
						item.error =
							"Server restarted during import. Its outcome is uncertain. Inspect local data before starting a new repair.";
					}
				await saveOwned(job);
				continue;
			}
			if (job.state !== "queued") continue;
			if (await store.isCancellationRequested(job.id)) {
				job.state = "cancelled";
				for (const item of job.items)
					if (item.state === "pending") item.state = "cancelled";
				await saveOwned(job);
				continue;
			}
			job.state = "running";
			await saveOwned(job);
			const operation = createStore("worker" as IpAddress);
			operation.requestId = (job.operationId ?? job.id) as RequestId;
			operation.userId = job.userId as UserId;
			await runWithStore(operation, () =>
				withCatalogExport(async () => {
					await ensureDirectories();
					const source = job.sourceId ? await getSource(job.sourceId) : null;
					for (const item of job.items) {
						await requireLease();
						if (item.state !== "pending") continue;
						if (await store.isCancellationRequested(job.id)) {
							for (const remaining of job.items)
								if (remaining.state === "pending")
									remaining.state = "cancelled";
							break;
						}
						item.state = "running";
						const onProgress = async (status: string) => {
							const phase = IMPORT_PHASES.find((value) => value === status);
							if (!phase) return;
							if (item.phase !== phase)
								item.phaseStartedAt = new Date().toISOString();
							item.phase = phase;
							await saveOwned(job);
						};
						await onProgress("validating");
						try {
							if (job.sourceId && !source)
								throw Error("Import source no longer exists");
							const providedNitro = item.attachmentId
								? await readFurnitureAttachment(
										item.attachmentId,
										item.classname,
										job.userId,
									)
								: undefined;
							await requireLease();
							const result = job.syncKind
								? await runSyncJobItem(item, onProgress)
								: await (job.mode === "repair"
										? repairFurniture
										: importSingleFurni)({
										...item,
										repairExisting: true,
										onProgress,
										resolveMissingNitro: async (revision) => {
											const recovered = await recoverFurnitureNitro(
												{ ...item, revision },
												{
													excludeSourceId: job.sourceId,
													onAttempt: async (name) => {
														item.sourceAttempt = name;
														await onProgress("checking_sources");
													},
												},
											);
											await requireLease();
											if (!recovered) return undefined;
											const { buffer, ...provenance } = recovered;
											item.recoveredSource = provenance;
											item.sourceAttempt = undefined;
											await saveOwned(job);
											return buffer;
										},
										providedNitro,
										sourceSwfBaseUrl: source?.sourceSwfBaseUrl,
										nitroBaseUrl: source?.nitroBaseUrl,
										iconBaseUrl: source?.iconBaseUrl,
									});
							await requireLease();
							item.warnings = result.warnings;
							item.itemId = result.itemId;
							if (!result.ok) throw Error(result.error || "Import failed");
							await logAudit({
								userId: job.userId,
								action: "furni_import",
								target: "ItemsBase",
								targetId: result.itemId ?? 0,
								after: {
									classname: item.classname,
									jobId: job.id,
									operationId: job.operationId,
									syncKind: job.syncKind,
									repairExisting: true,
								},
							}).catch((auditError) => {
								item.warnings ??= [];
								item.warnings.push("Audit record could not be saved");
								logServerError("furni.audit_failed", auditError, {
									jobId: job.id,
									classname: item.classname,
								});
							});
							if (job.translate && job.mode !== "repair")
								try {
									await onProgress("translating");
									await patchLocalizedFurniDataEntries([item], true, job.langs);
								} catch {
									item.warnings.push(
										"Translation failed; furniture imported successfully",
									);
								}
							item.state = "done";
						} catch (error) {
							if (error instanceof ImportLeaseLostError) throw error;
							await requireLease();
							logServerError("furni.item_failed", error, {
								jobId: job.id,
								classname: item.classname,
							});
							item.state = "failed";
							item.error =
								error instanceof Error ? error.message : "Import failed";
						}
						await saveOwned(job);
					}
					await requireLease();
					try {
						await rcon.updateCatalog();
						await requireLease();
						await rcon.updateItems();
					} catch (error) {
						if (error instanceof ImportLeaseLostError) throw error;
						for (const item of job.items)
							if (item.state === "done") {
								item.warnings ??= [];
								item.warnings.push("Game cache refresh failed");
							}
					} finally {
						// Offers and category pages were written either way; drop the
						// admin totals cache so the next read matches this job.
						invalidateCatalogTotals();
					}
				}),
			);
			await requireLease();
			job.state = job.items.some((item) => item.state === "cancelled")
				? "cancelled"
				: "completed";
			await saveOwned(job);
		}
		await requireLease();
		await runCatalogExport();
	} finally {
		clearInterval(timer);
		await redis
			.eval(
				"if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
				1,
				LOCK,
				token,
			)
			.catch((error) => {
				logServerError("furni.worker_release_failed", error);
			});
	}
}
