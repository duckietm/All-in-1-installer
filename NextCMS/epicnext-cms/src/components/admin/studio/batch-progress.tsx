"use client";

import {
	Ban,
	Check,
	Circle,
	CircleAlert,
	Loader2,
	RefreshCw,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BatchItemStatus, VerificationSummary } from "./studio-types";

const STATUS_KEYS: Record<BatchItemStatus["status"], string> = {
	pending: "status.pending",
	started: "status.started",
	downloading: "status.downloading",
	converting: "status.converting",
	writing_db: "status.writingDb",
	done: "status.done",
	failed: "status.failed",
};

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0s";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rest = s % 60;
	return rest > 0 ? `${m}m ${rest}s` : `${m}m`;
}

function formatRate(completed: number, ms: number): string {
	if (ms < 1500) return "";
	const perMinute = completed / (ms / 60000);
	if (perMinute < 1) return `${(completed / (ms / 1000)).toFixed(1)}/s`;
	return `${Math.round(perMinute)}/min`;
}

export const BatchProgress = memo(function BatchProgress({
	progress,
	done,
	succeeded,
	failed,
	cancelling,
	verification,
	failedClassnames,
	startTime,
	onCancel,
	onDismiss,
	onRetry,
}: {
	progress: Map<string, BatchItemStatus>;
	done: boolean;
	succeeded: number;
	failed: number;
	cancelling?: boolean;
	verification?: VerificationSummary | null;
	startTime?: number;
	failedClassnames?: string[];
	onCancel?: () => void;
	onDismiss?: () => void;
	onRetry?: (classnames: string[]) => void;
}) {
	const t = useTranslations("admin.studio.batch");
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (done) return;
		const id = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(id);
	}, [done]);

	// Relevance-first list: newest activity on top, capped so high-volume
	// imports don't render hundreds of DOM rows on every progress event.
	const VISIBLE_ITEMS = 60;
	const entries = useMemo(
		() => [...progress.values()].slice().reverse(),
		[progress],
	);
	const completed = useMemo(
		() =>
			entries.filter((i) => i.status === "done" || i.status === "failed")
				.length,
		[entries],
	);
	const total = entries.length;
	const percent = total ? Math.round((completed / total) * 100) : 0;
	const imported = done
		? succeeded
		: entries.filter((item) => item.status === "done").length;
	const errors = done
		? failed
		: entries.filter((item) => item.status === "failed").length;
	const unfinished = Math.max(0, total - completed);
	const elapsed = startTime ? now - startTime : 0;
	const rate = formatRate(completed, elapsed);
	const heading = !done
		? cancelling
			? t("headingStopping")
			: t("headingImporting")
		: unfinished
			? t("headingStopped")
			: errors
				? t("headingCompletedErrors")
				: t("headingCompleted");
	const issues = verification
		? verification.furniDataMissing + verification.furniDataConflicts
		: 0;

	return (
		<section
			aria-label={t("ariaProgress")}
			className="max-h-[45%] shrink-0 overflow-auto border-t border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div role="status" aria-live="polite">
					<h2
						style={{ fontSize: 14, margin: 0 }}
						className="text-sm font-semibold"
					>
						{heading}
					</h2>
					<p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--admin-text-muted)]">
						<span>
							<span className="font-semibold text-[var(--admin-success)]">
								{imported}
							</span>{" "}
							{t("imported")}
						</span>
						<span className="text-[var(--admin-border)]">·</span>
						<span>
							<span
								className={cn(
									"font-semibold",
									errors > 0 && "text-[var(--admin-error)]",
								)}
							>
								{errors}
							</span>{" "}
							{t("failed")}
						</span>
						{unfinished > 0 && (
							<>
								<span className="text-[var(--admin-border)]">·</span>
								<span>
									{unfinished} {done ? t("notCompleted") : t("remaining")}
								</span>
							</>
						)}
						{!done && startTime ? (
							<>
								<span className="text-[var(--admin-border)]">·</span>
								<span className="tabular-nums">{formatDuration(elapsed)}</span>
								{rate && (
									<span className="tabular-nums text-[var(--admin-accent)]">
										{rate}
									</span>
								)}
							</>
						) : null}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{done ? (
						<>
							{!!failedClassnames?.length && onRetry && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => onRetry(failedClassnames)}
								>
									<RefreshCw size={14} />
									{t("retryFailed", { count: failedClassnames.length })}
								</Button>
							)}
							<Button size="sm" variant="secondary" onClick={onDismiss}>
								<Check size={14} />
								{t("closeSummary")}
							</Button>
						</>
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={onCancel}
							disabled={cancelling}
						>
							{cancelling ? (
								<Loader2 className="animate-spin" size={14} />
							) : (
								<Ban size={14} />
							)}
							{t("stopImport")}
						</Button>
					)}
				</div>
			</div>
			<div
				role="progressbar"
				aria-label={t("ariaProcessed")}
				aria-valuemin={0}
				aria-valuemax={total || 1}
				aria-valuenow={completed}
				className="my-3 h-2 overflow-hidden rounded-full bg-[var(--admin-accent)]/10"
			>
				<div
					className="h-full rounded-full bg-gradient-to-r from-[var(--admin-accent)] to-[var(--admin-accent)]/70 transition-all"
					style={{ width: `${percent}%` }}
				/>
			</div>
			{done && verification && (
				<div className="mb-3 flex flex-wrap items-center gap-1.5">
					<p className="mr-1 text-sm text-[var(--admin-text-muted)]">
						{issues
							? t("verificationIssues", { count: issues })
							: t("verificationDone")}
					</p>
					<NodeChip
						count={verification.furniDataFixedIds}
						label={t("chipFurnidataIds")}
					/>
					<NodeChip
						count={verification.offerIdsFixed}
						label={t("chipOfferIds")}
					/>
					<NodeChip
						count={verification.ownershipFixed.length}
						label={t("chipOwnerships")}
					/>
					<NodeChip
						count={verification.nitrosSynced.length}
						label={t("chipNitros")}
					/>
					<NodeChip
						count={verification.iconsSynced.length}
						label={t("chipIcons")}
					/>
				</div>
			)}
			<details>
				<summary className="cursor-pointer text-xs font-medium">
					{t("viewItemDetails", { count: total })}
				</summary>
				<div className="mt-2 max-h-44 space-y-2 overflow-auto">
					{entries.length > VISIBLE_ITEMS && (
						<p className="px-1 text-[0.65rem] text-[var(--admin-text-muted)]">
							{t("showingItems", {
								shown: VISIBLE_ITEMS,
								total: entries.length,
							})}
						</p>
					)}
					{entries.slice(0, VISIBLE_ITEMS).map((item) => (
						<div
							key={item.classname}
							className="flex items-start gap-2 rounded-md bg-[var(--admin-canvas)] p-2 text-xs"
						>
							{item.status === "done" ? (
								<Check
									size={14}
									className="mt-0.5 shrink-0 text-[var(--admin-success)]"
								/>
							) : item.status === "failed" ? (
								<X
									size={14}
									className="mt-0.5 shrink-0 text-[var(--admin-error)]"
								/>
							) : done || item.status === "pending" ? (
								<Circle
									size={12}
									className="mt-0.5 shrink-0 text-[var(--admin-text-muted)]"
								/>
							) : (
								<Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
							)}
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-baseline justify-between gap-1">
									<span className="break-all font-medium">
										{item.classname}
									</span>
									<span className="shrink-0 text-[var(--admin-text-muted)]">
										{done && item.status !== "done" && item.status !== "failed"
											? t("statusNotCompleted")
											: t(STATUS_KEYS[item.status])}
									</span>
								</span>
								{item.message && (
									<span className="mt-0.5 block break-words text-[var(--admin-text-muted)]">
										{item.message}
									</span>
								)}
								{[...new Set(item.warnings ?? [])].map((warning) => (
									<span
										key={warning}
										className="mt-0.5 flex items-center gap-1 break-words text-[var(--admin-warning)]"
									>
										<CircleAlert size={11} className="shrink-0" />
										{warning}
									</span>
								))}
							</span>
						</div>
					))}
				</div>
			</details>
		</section>
	);
});

function NodeChip({ count, label }: { count: number; label: string }) {
	if (!count) return null;
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[var(--admin-success)]/30 bg-[var(--admin-success)]/10 px-2 py-0.5 text-[0.65rem] text-[var(--admin-success)]">
			<Check size={10} />
			{count} {label}
		</span>
	);
}
