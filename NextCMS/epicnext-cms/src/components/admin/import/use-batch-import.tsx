"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runSseImport } from "@/lib/sse-client";

export type BatchProgress = { done: number; total: number };

type UseBatchImportOptions = {
	/** SSE batch endpoint that emits item_progress / batch_complete events. */
	url: string;
	/** Toast suffix after a successful run: "pet(s) imported", "furni cloned", ... */
	successAction: string;
	/** Toast message shown when the user cancels a running batch. */
	cancelledMessage: string;
	/** Called once per successfully processed item with its key. */
	onItemDone?: (id: string) => void;
	/** Called when a batch finishes, after the result toasts. */
	onComplete?: (succeeded: number, failed: number) => void;
};

/**
 * Shared state + control for the admin SSE batch-import flows.
 * Owns the abort controller, running progress, and result toasts so the
 * import clients no longer each re-implement the same ~40 lines.
 */
export function useBatchImport({
	url,
	successAction,
	cancelledMessage,
	onItemDone,
	onComplete,
}: UseBatchImportOptions) {
	const [progress, setProgress] = useState<BatchProgress | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const cancel = useCallback(() => abortRef.current?.abort(), []);

	/**
	 * POST `body` to the batch endpoint. `keys` should mirror the batch;
	 * its length drives the progress display (`done/total`).
	 */
	const run = useCallback(
		async (keys: string[], body: Record<string, unknown>): Promise<void> => {
			abortRef.current?.abort();
			const abort = new AbortController();
			abortRef.current = abort;
			const total = keys.length;
			setProgress({ done: 0, total });
			let done = 0;
			const bump = (key: string) => {
				done++;
				onItemDone?.(key);
				setProgress({ done, total });
			};
			const bumpFailed = () => {
				done++;
				setProgress({ done, total });
			};
			try {
				await runSseImport(
					url,
					body,
					bump,
					(succeeded, failed) => {
						if (succeeded > 0) toast.success(`${succeeded} ${successAction}`);
						if (failed > 0) toast.error(`${failed} failed`);
						onComplete?.(succeeded, failed);
					},
					abort.signal,
					bumpFailed,
				);
			} catch (err) {
				if ((err as Error)?.name === "AbortError") toast.info(cancelledMessage);
				else throw err;
			} finally {
				if (abortRef.current === abort) abortRef.current = null;
				setProgress(null);
			}
		},
		[url, successAction, cancelledMessage, onItemDone, onComplete],
	);

	return { progress, running: progress !== null, run, cancel };
}

/** Inline "done/total + Cancel" cluster rendered while a batch is running. */
export function BatchImportProgress({
	progress,
	onCancel,
}: {
	progress: BatchProgress;
	onCancel: () => void;
}) {
	return (
		<>
			<span className="text-xs text-muted-foreground">
				{progress.done}/{progress.total}
			</span>
			<Button size="sm" variant="outline" className="h-8" onClick={onCancel}>
				Cancel
			</Button>
		</>
	);
}
