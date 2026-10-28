"use client";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import type { useFurnitureJobs } from "./use-furniture-jobs";

const HistoryBody = lazy(() =>
	import("./furniture-job-history-body").then((module) => ({
		default: module.FurnitureJobHistoryBody,
	})),
);
export function FurnitureJobHistory({
	state,
	expanded = false,
}: {
	state: ReturnType<typeof useFurnitureJobs>;
	expanded?: boolean;
}) {
	const t = useTranslations("pages.admin.importHistory");
	const common = useTranslations("pages.admin.housekeeping");
	const [opened, setOpened] = useState(expanded);
	return (
		<details
			open={expanded || undefined}
			onToggle={(event) => {
				if (event.currentTarget.open) setOpened(true);
			}}
			className="shrink-0 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2 text-sm"
		>
			<summary className="cursor-pointer">
				{t("summary", {
					count: state.jobs.filter(
						(job) => job.state === "queued" || job.state === "running",
					).length,
				})}
			</summary>
			{(opened || expanded) && (
				<Suspense
					fallback={
						<p role="status" className="py-2">
							{common("loading")}
						</p>
					}
				>
					<HistoryBody state={state} expanded={expanded} />
				</Suspense>
			)}
		</details>
	);
}
