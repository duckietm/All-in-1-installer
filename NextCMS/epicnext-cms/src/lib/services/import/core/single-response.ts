import { logServerError } from "@/lib/server-log";

/** Return headers immediately and keep proxies alive while one import completes. */
export function streamImportResponse(
	operation: () => Promise<Response>,
): Response {
	const encoder = new TextEncoder();
	let closed = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (data: unknown) => {
				if (!closed)
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
					);
			};
			send({ type: "progress", stage: "started" });
			timer = setInterval(
				() => send({ type: "progress", stage: "processing" }),
				10000,
			);
			void (async () => {
				try {
					const response = await operation();
					send({
						type: "result",
						status: response.status,
						data: await response.json(),
					});
				} catch (error) {
					logServerError("furni.import_stream_failed", error);
					send({
						type: "result",
						status: 500,
						data: {
							error:
								"Import interrupted on the server. Some changes may already be saved. Check the furniture status before retrying.",
						},
					});
				} finally {
					clearInterval(timer);
					if (!closed) {
						closed = true;
						controller.close();
					}
				}
			})();
		},
		cancel() {
			closed = true;
			clearInterval(timer);
		},
	});
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
