export interface SseWorkerResult {
	ok: boolean;
	warnings?: string[];
	error?: string;
}

export interface RunSseBatchOptions<T> {
	items: T[];
	concurrency: number;
	/** Abort when the client disconnects (e.g. `request.signal`). */
	signal?: AbortSignal;
	/** Label used as the `classname` field on item_progress (kept for the existing client parser). */
	labelOf: (item: T) => string;
	/** Per-item worker. `report(status)` streams intermediate progress (e.g. 'downloading'). */
	worker: (
		item: T,
		index: number,
		report: (status: string) => void,
	) => Promise<SseWorkerResult>;
	/**
	 * Optional finalizer run once after every item settles, before
	 * batch_complete is emitted. Lets callers flush deferred work (e.g. a single
	 * FurnitureData.json write) instead of doing it per item. Failures are
	 * surfaced as an `error` event without aborting the stream.
	 */
	flush?: () => Promise<void>;
}

/**
 * Generic SSE batch runner. Emits the same event shape the furni client
 * parser consumes: batch_start / item_progress / batch_complete.
 * Stops starting new chunks when `signal` aborts or the client cancels the stream.
 */
export function runSseBatch<T>(opts: RunSseBatchOptions<T>): Response {
	const { items, labelOf, worker, signal, flush } = opts;
	const concurrency = Math.min(Math.max(opts.concurrency || 3, 1), 12);
	const encoder = new TextEncoder();
	const ac = new AbortController();

	if (signal) {
		if (signal.aborted) ac.abort();
		else signal.addEventListener("abort", () => ac.abort(), { once: true });
	}

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: unknown) => {
				if (ac.signal.aborted) return;
				try {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
					);
				} catch {
					/* stream closed by client */
					ac.abort();
				}
			};

			const startTime = Date.now();
			send({ type: "batch_start", total: items.length, concurrency });

			let succeeded = 0;
			let failed = 0;
			let withWarnings = 0;

			for (let i = 0; i < items.length; i += concurrency) {
				if (ac.signal.aborted) break;

				const chunk = items.slice(i, i + concurrency);
				await Promise.allSettled(
					chunk.map(async (item, chunkIdx) => {
						if (ac.signal.aborted) return;
						const index = i + chunkIdx;
						const classname = labelOf(item);
						send({
							type: "item_progress",
							classname,
							status: "started",
							index,
						});
						try {
							// Coalesce micro-step progress ('downloading', 'converting',
							// ...) to at most one per 120ms per item so large imports
							// don't flood the client. Terminal states are emitted
							// separately below.
							let lastReportSent = 0;
							const result = await worker(item, index, (status) => {
								const now = Date.now();
								if (now - lastReportSent < 120) return;
								lastReportSent = now;
								send({
									type: "item_progress",
									classname,
									status,
									index,
								});
							});
							if (ac.signal.aborted) return;
							if (result.ok) {
								succeeded++;
								if (result.warnings?.length) withWarnings++;
								send({
									type: "item_progress",
									classname,
									status: "done",
									index,
									warnings: result.warnings?.length
										? result.warnings
										: undefined,
								});
							} else {
								failed++;
								send({
									type: "item_progress",
									classname,
									status: "failed",
									index,
									message: result.error,
								});
							}
						} catch (err) {
							if (ac.signal.aborted) return;
							failed++;
							send({
								type: "item_progress",
								classname,
								status: "failed",
								index,
								message: (err as Error).message,
							});
						}
					}),
				);
			}

			if (flush) {
				try {
					await flush();
				} catch (err) {
					send({
						type: "error",
						message: (err as Error).message,
					});
				}
			}

			if (!ac.signal.aborted) {
				send({
					type: "batch_complete",
					succeeded,
					failed,
					warnings: withWarnings,
					duration: Date.now() - startTime,
				});
			}
			try {
				controller.close();
			} catch {
				/* already closed */
			}
		},
		cancel() {
			ac.abort();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			// NGINX passes the progress on as it comes instead of buffering it.
			"X-Accel-Buffering": "no",
			Connection: "keep-alive",
		},
	});
}
