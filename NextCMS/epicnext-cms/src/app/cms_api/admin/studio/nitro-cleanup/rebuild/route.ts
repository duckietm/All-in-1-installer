import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { clearFurniImportCache } from "@/lib/services/furni-import-cache";
import {
	type NitroRepairProgress,
	refreshScanCacheAfterMutation,
	repairBrokenNitros,
} from "@/lib/services/nitro-cleanup";

type RepairSummary = {
	repaired: number;
	failed: number;
	errors?: string[];
};

/**
 * Re-download the given broken .nitro bundles from the configured nitro
 * sources. Bundles are pulled in parallel server-side; when the client asks
 * for `text/event-stream` a `progress` event is streamed after every bundle
 * settles plus a final `result` event, mirroring the scan endpoint so a large
 * repair batch cannot be cut off by a reverse-proxy timeout and can be
 * cancelled client-side.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		let body: { fileNames?: unknown };
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
		if (fileNames.length === 0) {
			return apiError("fileNames[] is required", 400);
		}

		const summarize = (result: {
			repaired: number;
			failed: number;
			errors: string[];
		}): RepairSummary => ({
			repaired: result.repaired,
			failed: result.failed,
			errors: result.errors.length > 0 ? result.errors : undefined,
		});

		const finish = async (result: {
			repaired: number;
			failed: number;
			errors: string[];
			files: Array<{ fileName: string; ok: boolean }>;
		}) => {
			// Repaired bundles are no longer broken — drop them from the cached
			// scan (names/digests unchanged, so the cache otherwise stays valid).
			await refreshScanCacheAfterMutation(
				"nitro",
				result.files.filter((file) => file.ok).map((file) => file.fileName),
				0,
			);
			clearFurniImportCache();
			if (result.repaired > 0) {
				logAudit({
					userId: ctx.session.user.id,
					action: "nitro_cleanup_repair",
					target: "NitroFiles",
					after: {
						repaired: result.repaired,
						failed: result.failed,
						fileNames,
						errors: result.errors.length > 0 ? result.errors : undefined,
					},
				});
			}
			return summarize(result);
		};

		const wantsSse = request.headers
			.get("accept")
			?.includes("text/event-stream");
		try {
			if (!wantsSse) {
				return apiOk(await finish(await repairBrokenNitros(fileNames)));
			}
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
						const result = await repairBrokenNitros(fileNames, {
							onProgress: (progress: NitroRepairProgress) =>
								send({ type: "progress", ...progress }),
						});
						send({ type: "result", ...(await finish(result)) });
					} catch (err) {
						send({
							type: "error",
							message: `Nitro repair failed: ${(err as Error).message}`,
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
		} catch (err) {
			return apiError(`Nitro repair failed: ${(err as Error).message}`, 500);
		}
	},
);
