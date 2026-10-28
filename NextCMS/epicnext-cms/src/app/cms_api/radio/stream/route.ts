import { fetchListeners, fetchNowPlaying } from "@/lib/services/radio";

/**
 * Server-Sent Events stream of live radio state (AtomCMS's radio SSE endpoint).
 * Pushes { nowPlaying, listeners } every ~10s so players/widgets get real-time
 * updates without polling. Closes cleanly when the client disconnects.
 */
export async function GET(req: Request) {
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;

			const send = async () => {
				if (closed) return;
				const [nowPlaying, listeners] = await Promise.all([
					fetchNowPlaying().catch(() => null),
					fetchListeners().catch(() => null),
				]);
				// Only changes go out (the ping below keeps the connection alive in between).
				const payload = JSON.stringify({ nowPlaying, listeners });
				if (payload === lastPayload) return;
				lastPayload = payload;
				try {
					controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
				} catch {
					closed = true;
				}
			};

			// Initial event immediately, then on an interval.
			let lastPayload = "";
			await send();
			const interval = setInterval(() => void send(), 10_000);
			// SSE comment as a keep-alive ping between data events.
			const ping = setInterval(() => {
				if (!closed) {
					try {
						controller.enqueue(encoder.encode(": ping\n\n"));
					} catch {
						closed = true;
					}
				}
			}, 25_000);

			const stop = () => {
				closed = true;
				clearInterval(interval);
				clearInterval(ping);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			req.signal.addEventListener("abort", stop);
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store, no-transform",
			"x-accel-buffering": "no",
			connection: "keep-alive",
		},
	});
}
