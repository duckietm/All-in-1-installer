"use client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { retryableJobItems } from "@/lib/furni/import-job-retry";
import { ImportAttachmentRecovery } from "./import-attachment-recovery";
import type { useFurnitureJobs } from "./use-furniture-jobs";
export function FurnitureJobHistoryBody({
	state,
	expanded = false,
}: {
	state: ReturnType<typeof useFurnitureJobs>;
	expanded?: boolean;
}) {
	const t = useTranslations("pages.admin.importHistory");
	const format = useFormatter();
	const progressT = useTranslations("pages.admin.importProgress");
	const [limits, setLimits] = useState<Record<string, number>>({});
	return (
		<div
			className={
				expanded ? "space-y-2 py-2" : "max-h-72 space-y-2 overflow-auto py-2"
			}
		>
			{state.error && <p role="alert">{state.error}</p>}
			<p className="text-xs text-[var(--admin-text-muted)]">
				{state.paginated ? t("ownerHistory") : t("historyLimit")}
			</p>
			<Button variant="outline" onClick={() => void state.refresh()}>
				{t("refreshHistory")}
			</Button>
			{state.paginated && (
				<div className="flex items-center gap-3">
					<Button
						variant="outline"
						disabled={state.loading || state.page === 1}
						onClick={() => void state.navigate("previous")}
					>
						{t("previousPage")}
					</Button>
					<span>{t("page", { page: state.page })}</span>
					<Button
						variant="outline"
						disabled={state.loading || !state.nextCursor}
						onClick={() => void state.navigate("next")}
					>
						{t("nextPage")}
					</Button>
				</div>
			)}
			{!state.jobs.length && !state.loading && !state.error && (
				<p>{t("empty")}</p>
			)}
			{state.jobs.map((job) => {
				const retryItems = retryableJobItems(job);
				const done = job.items.filter((i) => i.state === "done"),
					failed = job.items.filter((i) => i.state === "failed");
				return (
					<details
						key={job.id}
						className="rounded border border-[var(--admin-border)] p-2"
					>
						<summary className="cursor-pointer">
							{format.dateTime(new Date(job.createdAt), {
								dateStyle: "short",
								timeStyle: "short",
							})}{" "}
							· {t(job.state)} ·{" "}
							{t("result", {
								done: done.length,
								total: job.items.length,
								failed: failed.length,
							})}
						</summary>
						<progress
							className="mt-2 h-2 w-full"
							value={done.length + failed.length}
							max={Math.max(1, job.items.length)}
							aria-label={t("progress")}
						/>
						<ul className="space-y-1 py-2">
							{job.items.slice(0, limits[job.id] ?? 50).map((item) => (
								<li key={item.classname}>
									<strong>{item.classname}</strong> · {t(item.state)}
									{item.itemId ? ` · ID ${item.itemId}` : ""}
									{item.phase &&
										(item.state === "running" ||
											item.state === "failed" ||
											item.state === "interrupted") && (
											<p className="text-xs text-[var(--admin-text-muted)]">
												{progressT(
													item.state === "running" ? "current" : "last",
													{ phase: progressT(item.phase) },
												)}
												{item.state === "running" &&
													item.phaseStartedAt &&
													` · ${progressT("elapsed", { seconds: Math.max(0, Math.floor((Date.now() - Date.parse(item.phaseStartedAt)) / 1000)) })}`}
												{item.sourceAttempt && ` · ${item.sourceAttempt}`}
											</p>
										)}
									{item.recoveredSource && (
										<p className="break-words text-xs text-[var(--admin-text-muted)]">
											{progressT("recovered", {
												source: item.recoveredSource.sourceName,
												revision: item.recoveredSource.revision,
											})}
										</p>
									)}
									{item.error && (
										<p className="text-[var(--admin-warning)]">{item.error}</p>
									)}
									{!job.syncKind &&
										item.state === "failed" &&
										retryItems.some(
											(retryItem) => retryItem.classname === item.classname,
										) && (
											<ImportAttachmentRecovery
												jobId={job.id}
												classname={item.classname}
												disabled={state.busy}
												onResumed={state.refresh}
											/>
										)}
									{[...new Set(item.warnings ?? [])].map((warning) => (
										<p
											key={warning}
											className="text-xs text-[var(--admin-text-muted)]"
										>
											{warning}
										</p>
									))}
								</li>
							))}
						</ul>
						{job.items.length > (limits[job.id] ?? 50) && (
							<Button
								variant="outline"
								onClick={() =>
									setLimits((current) => ({
										...current,
										[job.id]: (current[job.id] ?? 50) + 50,
									}))
								}
							>
								{t("showMoreItems")}
							</Button>
						)}
						{(job.state === "queued" || job.state === "running") && (
							<div className="space-y-2 py-2">
								<p className="text-xs text-[var(--admin-text-muted)]">
									{t(job.cancelRequested ? "cancelRequested" : "cancelHint")}
								</p>
								<Button
									variant="outline"
									disabled={state.cancelling !== null || job.cancelRequested}
									onClick={() => void state.cancel(job.id)}
								>
									{t("cancelRemaining")}
								</Button>
							</div>
						)}
						{job.items.some(
							(item) =>
								item.state === "interrupted" ||
								item.error?.startsWith("Server restarted during import.") ||
								(item.state === "running" && job.state === "interrupted"),
						) && (
							<p role="alert" className="py-2 text-[var(--admin-warning)]">
								{t("uncertainOutcome")}{" "}
								<Link href="/admin/studio/audit" className="underline">
									{t("reviewLocalData")}
								</Link>
							</p>
						)}
						{retryItems.length > 0 && (
							<Button
								variant="outline"
								disabled={state.busy}
								onClick={() => void state.retry(job.id)}
							>
								{t(
									job.state === "interrupted" || job.state === "cancelled"
										? "retryUnfinished"
										: "retryFailed",
								)}
							</Button>
						)}
					</details>
				);
			})}
		</div>
	);
}
