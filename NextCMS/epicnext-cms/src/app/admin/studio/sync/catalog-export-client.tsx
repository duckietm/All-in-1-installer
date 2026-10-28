"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { adminFetch } from "@/lib/admin-fetch";

import { CatalogGitConfiguration } from "./catalog-git-configuration";

type ExportStatus = {
	remote?: string;
	branch?: string;
	enabled: boolean;
	pending: number;
	active: number;
	running?: boolean;
	commit?: string;
	finishedAt?: string;
	error?: string;
};

export function CatalogExportClient({
	canConfigure = false,
	monitorOnly = false,
}: {
	canConfigure?: boolean;
	monitorOnly?: boolean;
}) {
	const t = useTranslations("pages.admin.operationsExport");
	const submitting = useRef(false);
	const [status, setStatus] = useState<ExportStatus | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const refreshing = useRef(false);
	const refresh = useCallback(async () => {
		if (refreshing.current) return;
		refreshing.current = true;
		try {
			const response = await adminFetch("/api/admin/catalog-export", {
				cache: "no-store",
			});
			if (!response.ok) throw new Error(t("loadError"));
			setStatus(await response.json());
			setError("");
		} catch {
			setError(t("loadError"));
		} finally {
			refreshing.current = false;
		}
	}, [t]);
	useVisiblePolling(refresh, 15000);
	async function retry() {
		if (submitting.current) return;
		submitting.current = true;
		setBusy(true);
		try {
			const response = await adminFetch("/api/admin/catalog-export", {
				method: "POST",
			});
			if (!response.ok) throw new Error(t("queueError"));
			await refresh();
		} catch {
			setError(t("queueError"));
		} finally {
			setBusy(false);
			submitting.current = false;
		}
	}
	return (
		<section className="space-y-3 rounded-lg border border-[var(--admin-border)] p-4">
			<h2 className="text-lg font-semibold">{t("title")}</h2>
			<p className="text-sm text-muted-foreground">{t("hint")}</p>
			{canConfigure && (
				<CatalogGitConfiguration onSaved={() => void refresh()} />
			)}
			{status?.remote && (
				<p className="text-xs break-all">
					{status.remote} · {status.branch}
				</p>
			)}
			<div role="status" className="text-sm" aria-live="polite">
				{!status
					? t("loading")
					: !status.enabled
						? t("disabled")
						: status.active
							? t("active", { count: status.active })
							: status.running
								? t("running")
								: status.pending
									? t("pending", { count: status.pending })
									: t("idle")}
				{status?.commit && (
					<p>
						{t("lastCommit")}{" "}
						<a
							className="underline"
							href={`${status.remote?.replace(/\.git$/, "")}/commit/${status.commit}`}
							target="_blank"
							rel="noreferrer"
						>
							{status.commit.slice(0, 12)}
						</a>
					</p>
				)}
				{status?.finishedAt && (
					<p>{t("lastAttempt", { date: status.finishedAt })}</p>
				)}
			</div>
			{(error || status?.error) && (
				<p role="alert" className="text-sm">
					{error || status?.error}
				</p>
			)}
			{!monitorOnly && (
				<button
					type="button"
					disabled={
						!status?.enabled ||
						busy ||
						Boolean(status.running) ||
						status.active > 0
					}
					onClick={retry}
					className="rounded-md border border-[var(--admin-border)] px-3 py-2 text-sm disabled:opacity-50"
				>
					{busy ? "Queuing…" : "Export now / retry"}
				</button>
			)}
		</section>
	);
}
