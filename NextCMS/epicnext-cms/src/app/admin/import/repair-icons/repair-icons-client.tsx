"use client";

import { Check, ImageIcon, Loader2, Wrench } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";

interface RepairEvent {
	type: string;
	classname?: string;
	status?: string;
	index?: number;
	total?: number;
	succeeded?: number;
	failed?: number;
	skipped?: number;
	message?: string;
	warnings?: string[];
}

export function RepairIconsClient() {
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
	} | null>(null);
	const [log, setLog] = useState<string[]>([]);
	const [result, setResult] = useState<{
		succeeded: number;
		failed: number;
		skipped: number;
	} | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const startRepair = useCallback(async () => {
		setRunning(true);
		setProgress(null);
		setLog([]);
		setResult(null);

		const abort = new AbortController();
		abortRef.current = abort;

		try {
			const res = await adminFetch("/api/admin/import/furni/repair-icons", {
				method: "POST",
				signal: abort.signal,
			});

			if (!res.body) {
				toast.error("No response stream");
				setRunning(false);
				return;
			}

			if (!res.headers.get("content-type")?.includes("text/event-stream")) {
				let errMsg = "Repair failed";
				try {
					const json = await res.json();
					errMsg = json.error || errMsg;
				} catch {
					// ignore
				}
				toast.error(errMsg);
				setRunning(false);
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			let total = 0;
			let succeeded = 0;
			let failed = 0;
			let skipped = 0;

			while (true) {
				const { value, done: streamDone } = await reader.read();
				if (streamDone) break;
				buf += decoder.decode(value, { stream: true });
				const parts = buf.split("\n\n");
				buf = parts.pop() ?? "";
				for (const part of parts) {
					if (!part.startsWith("data: ")) continue;
					try {
						const evt = JSON.parse(part.slice(6)) as RepairEvent;

						if (evt.type === "started") {
							total = evt.total ?? 0;
							setProgress({ done: 0, total });
							setLog((prev) => [...prev, `Scanning ${total} furniture items…`]);
						}

						if (evt.type === "progress") {
							const processed = (evt.index ?? 0) + 1;
							setProgress({ done: processed, total });
							if (evt.status === "skipped") {
								skipped++;
							} else if (evt.status === "done") {
								succeeded++;
							} else if (evt.status === "failed") {
								failed++;
							}
							const icon =
								evt.status === "done"
									? "✓"
									: evt.status === "failed"
										? "✗"
										: "–";
							setLog((prev) => [
								...prev,
								`${icon} ${evt.classname ?? ""} (${evt.status})`,
							]);
						}

						if (evt.type === "batch_complete") {
							succeeded = evt.succeeded ?? succeeded;
							failed = evt.failed ?? failed;
							skipped = evt.skipped ?? skipped;
						}

						if (evt.type === "error") {
							setLog((prev) => [
								...prev,
								`ERROR: ${evt.message ?? "Unknown error"}`,
							]);
							toast.error(evt.message ?? "Repair failed");
						}
					} catch {
						// skip parse errors
					}
				}
			}

			setResult({ succeeded, failed, skipped });
			if (succeeded > 0) toast.success(`${succeeded} icons downloaded`);
			if (failed > 0) toast.error(`${failed} icons could not be obtained`);
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				toast.info("Repair cancelled");
			} else {
				toast.error("Repair request failed");
			}
		} finally {
			setRunning(false);
			abortRef.current = null;
		}
	}, []);

	return (
		<div className="space-y-4">
			{!result && (
				<div className="flex items-center gap-2 flex-wrap">
					<Button onClick={startRepair} disabled={running} size="lg">
						{running ? (
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
						) : (
							<Wrench className="w-4 h-4 mr-2" />
						)}
						{running
							? `Repairing… ${progress ? `${progress.done}/${progress.total}` : ""}`
							: "Start Icon Repair"}
					</Button>
					{running && (
						<Button
							variant="outline"
							size="lg"
							onClick={() => abortRef.current?.abort()}
						>
							Cancel
						</Button>
					)}
				</div>
			)}

			{progress && (
				<div className="text-sm text-muted-foreground">
					Processed {progress.done} / {progress.total} items
				</div>
			)}

			{log.length > 0 && (
				<div className="rounded-xl border bg-card p-4 max-h-80 overflow-x-auto overflow-y-auto space-y-0.5">
					{log.map((line) => (
						<div
							key={line}
							className="text-xs font-mono text-muted-foreground whitespace-nowrap"
						>
							{line}
						</div>
					))}
				</div>
			)}

			{result && (
				<div className="rounded-xl border bg-card p-5 space-y-3">
					<div className="flex items-center gap-2">
						<Check className="w-5 h-5 text-[var(--admin-success)]" />
						<span className="text-lg font-semibold">Repair Complete</span>
					</div>
					<div className="text-sm space-y-1">
						<p>
							<span className="text-muted-foreground">Downloads:</span>{" "}
							{result.succeeded}
						</p>
						<p>
							<span className="text-muted-foreground">
								Skipped (already had icon):
							</span>{" "}
							{result.skipped}
						</p>
						<p>
							<span className="text-muted-foreground">Failed:</span>{" "}
							{result.failed}
						</p>
					</div>
					<Button
						variant="outline"
						onClick={() => {
							setResult(null);
							setLog([]);
						}}
					>
						Run Again
					</Button>
				</div>
			)}

			{!running && !result && (
				<div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
					<ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
					<p>
						Scans all furniture in the database and downloads any missing icon
						files. Icons are extracted from local .nitro bundles or downloaded
						from configured clone sources.
					</p>
				</div>
			)}
		</div>
	);
}
