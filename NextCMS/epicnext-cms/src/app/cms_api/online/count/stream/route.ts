// Server-Sent Events stream of the live online user count for the in-game
// client toolbar. Pushes { count } every ~5s so the counter updates in
// real-time without the client polling. Closes cleanly when the client
// disconnects.
//
// The first event is sent immediately; subsequent events push the cached
// count (10s TTL in the REST endpoint) so repeated reads share one query.

import { count, eq } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { db, User } from "@/lib/db";
import { rcon } from "@/lib/services/rcon";

async function fetchOnlineCount(): Promise<number> {
	try {
		return await cached(
			"online_count",
			10_000,
			async () => {
				const [row] = await db
					.select({ total: count() })
					.from(User)
					.where(eq(User.online, "1"));
				return row?.total ?? 0;
			},
			// A subscriber must never wait on a COUNT(*) to get its next event.
			{ staleMs: 15_000 },
		);
	} catch {
		return 0;
	}
}

// Emulator (RCON) reachability, cached and shared across all subscribers so an
// N-client toolbar doesn't fire N pings every interval. Falls back to graceful
// degradation on failure so the stream never errors out.
async function fetchEmulatorStatus(): Promise<boolean> {
	try {
		return await cached(
			"emulator_rcon_status",
			15_000,
			() => rcon.send("ping", null).catch(() => false),
			// Reachability is reported, never acted on, so a previous answer is
			// good enough while the ping is re-run.
			{ staleMs: 15_000 },
		);
	} catch {
		return false;
	}
}

export async function GET(req: Request) {
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;

			const send = async () => {
				if (closed) return;
				const [count, emulator] = await Promise.all([
					fetchOnlineCount(),
					fetchEmulatorStatus(),
				]);
				// Only changes go out (the ping below keeps the connection alive in between).
				const payload = JSON.stringify({ count, emulator });
				if (payload === lastPayload) return;
				lastPayload = payload;
				try {
					controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
				} catch {
					closed = true;
				}
			};

			// Initial event immediately, then every 10 s: the count itself is cached for 10 s.
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
