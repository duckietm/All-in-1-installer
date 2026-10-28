import { toast } from "sonner";
import { adminFetch } from "@/lib/admin-fetch";

export type SseEvent = Record<string, unknown>;

/** Default idle timeout: if no SSE event arrives for this long, abort. */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Read an SSE response body and invoke `onEvent` for each `data:` JSON payload.
 * Aborts if no event arrives within `idleTimeoutMs` (default 60s).
 */
export async function readSseStream(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: SseEvent) => void,
	signal?: AbortSignal,
	idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let done = false;

	const resetIdleTimer = () => {
		if (idleTimer) clearTimeout(idleTimer);
		if (idleTimeoutMs > 0) {
			idleTimer = setTimeout(() => {
				if (!done) {
					reader.cancel("SSE idle timeout").catch(() => {});
				}
			}, idleTimeoutMs);
		}
	};

	try {
		resetIdleTimer();
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				break;
			}
			const { value, done: streamDone } = await reader.read();
			if (streamDone) break;
			resetIdleTimer();
			buf += decoder.decode(value, { stream: true });
			const parts = buf.split("\n\n");
			buf = parts.pop() ?? "";
			for (const part of parts) {
				if (!part.startsWith("data: ")) continue;
				try {
					onEvent(JSON.parse(part.slice(6)) as SseEvent);
				} catch {
					/* skip malformed events */
				}
			}
		}
	} finally {
		done = true;
		if (idleTimer) clearTimeout(idleTimer);
		reader.releaseLock();
	}
}

/**
 * POST JSON to an admin SSE import endpoint and drive the standard
 * item_progress / batch_complete callbacks used by clothing & clone clients.
 */
export async function runSseImport(
	url: string,
	body: unknown,
	onDone: (classname: string) => void,
	onComplete: (succeeded: number, failed: number) => void,
	signal?: AbortSignal,
	onFailed?: (classname: string, error?: string) => void,
): Promise<void> {
	const res = await adminFetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		toast.error(
			typeof data.error === "string"
				? data.error
				: `Import failed (${res.status})`,
		);
		onComplete(0, 0);
		return;
	}
	if (!res.body) {
		toast.error("No response stream");
		onComplete(0, 0);
		return;
	}

	let succeeded = 0;
	let failed = 0;

	await readSseStream(
		res.body,
		(evt) => {
			if (evt.type === "item_progress") {
				const classname = String(evt.classname ?? "");
				if (evt.status === "done") {
					onDone(classname);
				} else if (evt.status === "failed") {
					onFailed?.(classname, String(evt.error ?? ""));
				}
			}
			if (evt.type === "error") {
				toast.error(
					typeof evt.message === "string"
						? evt.message
						: "Import finished with errors",
				);
			}
			if (evt.type === "batch_complete") {
				succeeded = Number(evt.succeeded ?? 0);
				failed = Number(evt.failed ?? 0);
			}
		},
		signal,
	);

	onComplete(succeeded, failed);
}
