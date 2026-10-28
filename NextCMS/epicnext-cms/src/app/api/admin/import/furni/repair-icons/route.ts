import { withAdmin } from "@/lib/api-handler";
import { purgeEdgeCache } from "@/lib/edge-cache";
import { PERMS } from "@/lib/permissions";
import { repairMissingIcons } from "@/lib/services/repair-icons";

function sseEvent(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const encoder = new TextEncoder();

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
				await repairMissingIcons(send);
				// After icon repair, purge the Cloudflare edge cache so updated
				// icons are immediately visible instead of waiting for the 1-year
				// s-maxage to expire.
				try {
					await purgeEdgeCache(["cms-furni-icons"], "repair-missing-icons");
					send({ type: "purge", tag: "cms-furni-icons" });
				} catch (purgeError) {
					send({
						type: "error",
						message: `repairMissingIcons completed but purge failed: ${(purgeError as Error).message}`,
					});
				}
			} catch (err) {
				send({
					type: "error",
					message: `repairMissingIcons threw: ${(err as Error).message}`,
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
});
