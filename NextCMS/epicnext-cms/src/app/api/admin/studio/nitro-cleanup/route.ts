import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { clearFurniImportCache } from "@/lib/services/furni-import-cache";
import {
	type AssetCleanupEntry,
	ageDays,
	type CleanupAssetKind,
	deleteNitroCleanupFiles,
	getPersistedCleanupResult,
	refreshScanCacheAfterMutation,
} from "@/lib/services/nitro-cleanup";

const VALID_KINDS: readonly CleanupAssetKind[] = ["nitro", "swf", "icon"];
const GROUP_ORDER = ["fake", "broken", "orphanedSwf", "orphanedIcon"] as const;
type GroupKey = (typeof GROUP_ORDER)[number];
const CHUNK_SIZE = 400;

function intParam(value: string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function ageFilter<T extends { lastModified: number }>(
	entries: T[],
	minAgeDays: number | null,
): T[] {
	return minAgeDays !== null && minAgeDays > 0
		? entries.filter((entry) => ageDays(entry.lastModified) >= minAgeDays)
		: entries;
}

/**
 * Serve the persisted scan result (written by the background scan started
 * through POST `/run`).
 *
 * With `Accept: text/event-stream` the lists are streamed in bounded chunks
 * (`summary` + `chunk` events) so a result with hundreds of thousands of
 * entries is delivered without one giant JSON payload. With a plain Accept the
 * full result is returned as JSON, which is also how the manifest export works.
 *
 * Query params:
 *  - `minAgeDays=N` (SSE + JSON) only returns entries older than N days.
 */
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const wantsSse = request.headers
			.get("accept")
			?.includes("text/event-stream");
		const minAgeDays = intParam(request.nextUrl.searchParams.get("minAgeDays"));
		try {
			const persisted = await getPersistedCleanupResult();
			if (wantsSse) {
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					async start(controller) {
						const send = (data: unknown) => {
							try {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
								);
							} catch {
								/* stream closed by client */
							}
						};
						try {
							if (!persisted) {
								send({
									type: "error",
									message:
										"No scan result yet — run a furniture asset scan first.",
								});
							} else {
								const groups: Partial<Record<GroupKey, AssetCleanupEntry[]>> = {
									fake: ageFilter(persisted.fake, minAgeDays),
									broken: ageFilter(persisted.broken, minAgeDays),
									orphanedSwf: ageFilter(persisted.orphanedSwf, minAgeDays),
									orphanedIcon: ageFilter(persisted.orphanedIcon, minAgeDays),
								};
								send({
									type: "summary",
									total: persisted.total,
									cached: persisted.cached ?? false,
									minAgeDays: minAgeDays ?? 0,
									groups: Object.fromEntries(
										Object.entries(groups).map(([key, value]) => [
											key,
											(value ?? []).length,
										]),
									),
								});
								for (const group of GROUP_ORDER) {
									const entries = groups[group] ?? [];
									for (
										let offset = 0;
										offset < entries.length;
										offset += CHUNK_SIZE
									) {
										send({
											type: "chunk",
											group,
											offset,
											entries: entries.slice(offset, offset + CHUNK_SIZE),
										});
									}
								}
							}
						} catch (err) {
							send({
								type: "error",
								message: `Failed to read scan result: ${(err as Error).message}`,
							});
						}
						try {
							controller.close();
						} catch {
							/* ignore */
						}
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
			}
			if (!persisted) {
				return apiError(
					"No scan result yet — run a furniture asset scan first.",
					404,
				);
			}
			return apiOk({
				...persisted,
				minAgeDays: minAgeDays ?? 0,
				cached: persisted.cached ?? false,
			});
		} catch (err) {
			return apiError(
				`Failed to read scan result: ${(err as Error).message}`,
				500,
			);
		}
	},
);

/**
 * Delete the given asset files (default .nitro) from every matching directory
 * (public + mirrored gamedata).
 */
export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		let body: { fileNames?: unknown; kind?: unknown };
		try {
			body = await request.json();
		} catch {
			return apiError("Invalid JSON body", 400);
		}
		const fileNames = Array.isArray(body?.fileNames)
			? body.fileNames.filter(
					(name): name is string => typeof name === "string",
				)
			: [];
		const kind: CleanupAssetKind = VALID_KINDS.includes(
			body?.kind as CleanupAssetKind,
		)
			? (body.kind as CleanupAssetKind)
			: "nitro";
		if (fileNames.length === 0) {
			return apiError("fileNames[] is required", 400);
		}
		try {
			const result = await deleteNitroCleanupFiles(fileNames, kind);
			// Keep the persisted scan and the furniture list consistent without
			// re-scanning: drop the removed files from the scan cache and clear
			// the furniture presence cache so the Studio reflects it immediately.
			await refreshScanCacheAfterMutation(
				kind,
				result.files
					.filter((file) => file.deleted)
					.map((file) => file.fileName),
				result.deleted,
			);
			clearFurniImportCache();
			if (result.deleted > 0) {
				logAudit({
					userId: ctx.session.user.id,
					action: "nitro_cleanup_delete",
					target: "AssetFiles",
					after: {
						kind,
						deleted: result.deleted,
						copiesRemoved: result.copiesRemoved,
						fileNames,
						errors: result.errors.length > 0 ? result.errors : undefined,
					},
				});
			}
			return apiOk({
				deleted: result.deleted,
				copiesRemoved: result.copiesRemoved,
				errors: result.errors.length > 0 ? result.errors : undefined,
			});
		} catch (err) {
			return apiError(`Asset cleanup failed: ${(err as Error).message}`, 500);
		}
	},
);
