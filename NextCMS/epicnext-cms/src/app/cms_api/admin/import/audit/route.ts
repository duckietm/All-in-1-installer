import { withAdmin } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { runCatalogAudit } from "@/lib/services/catalog-audit";

function sseEvent(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const encoder = new TextEncoder();

		let repair = false;
		let repairNitros = false;
		let sql = false;
		let applySql = false;
		let repairFurniData = false;
		let repairStructure = false;
		let checkFurniDataIds = false;
		try {
			const body = (await request.json().catch(() => ({}))) as {
				repair?: unknown;
				repairNitros?: unknown;
				sql?: unknown;
				applySql?: unknown;
				repairFurniData?: unknown;
				repairStructure?: unknown;
				checkFurniDataIds?: unknown;
			};
			repair = body.repair === true;
			repairNitros = body.repairNitros === true;
			sql = body.sql === true;
			applySql = body.applySql === true;
			repairFurniData = body.repairFurniData === true;
			repairStructure = body.repairStructure === true;
			checkFurniDataIds = body.checkFurniDataIds === true;
		} catch (err) {
			logger.warn("Failed to parse audit request body", { err });
		}

		const stream = new ReadableStream({
			async start(controller) {
				const send = (data: unknown) => {
					try {
						controller.enqueue(encoder.encode(sseEvent(data)));
					} catch {
						/* stream closed */
					}
				};

				try {
					await runCatalogAudit(send, {
						repair,
						repairNitros,
						sql,
						applySql,
						repairFurniData,
						repairStructure,
						checkFurniDataIds,
					});
				} catch (err) {
					send({
						type: "error",
						message: `Audit threw: ${(err as Error).message}`,
					});
				}

				try {
					controller.close();
				} catch (err) {
					logger.warn("Failed to close audit SSE stream", { err });
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
	},
);
