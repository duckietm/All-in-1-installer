"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
	applyCatalogIntegrityRepairAction,
	inspectCatalogIntegrityAction,
	previewCatalogIntegrityRepairAction,
} from "@/actions/catalog-integrity";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type {
	IntegrityCatalog,
	inspectCatalogIntegrity,
} from "@/lib/services/catalog-integrity";
import type { CatalogParentRepairPreview } from "@/lib/services/catalog-repair";

type Report = ReturnType<typeof inspectCatalogIntegrity>;
export function CatalogIntegrityPanel({ canRepair }: { canRepair: boolean }) {
	const t = useTranslations("pages.admin.catalog.integrity");
	const [catalog, setCatalog] = useState<IntegrityCatalog>("normal");
	const [report, setReport] = useState<Report | null>(null);
	const [preview, setPreview] = useState<CatalogParentRepairPreview | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<"failed" | "stalePreview" | null>(null);
	const [applied, setApplied] = useState<number | null>(null);
	const [refresh, setRefresh] = useState(0);
	const request = useRef(0);
	const applying = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh starts a new read-only scan; read via setRefresh
	useEffect(() => {
		const version = ++request.current;
		setBusy(true);
		setReport(null);
		setPreview(null);
		setError(null);
		void inspectCatalogIntegrityAction(catalog)
			.then((result) => {
				if (version !== request.current) return;
				if (result.ok && result.data) setReport(result.data);
				else setError("failed");
			})
			.catch(() => {
				if (version === request.current) setError("failed");
			})
			.finally(() => {
				if (version === request.current) setBusy(false);
			});
		return () => {
			request.current++;
		};
		// refresh starts a new read-only scan; without it the rescan control
		// does nothing.
	}, [catalog, refresh]);
	async function prepare() {
		setBusy(true);
		setPreview(null);
		setError(null);
		setApplied(null);
		try {
			const result = await previewCatalogIntegrityRepairAction(catalog);
			if (result.ok && result.data) setPreview(result.data);
			else setError("failed");
		} catch {
			setError("failed");
		} finally {
			setBusy(false);
		}
	}
	async function apply() {
		if (!preview || applying.current) return;
		applying.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = await applyCatalogIntegrityRepairAction(
				preview.catalog,
				preview.fingerprint,
			);
			setPreview(null);
			if (result.ok && result.data) {
				setApplied(result.data.applied);
				setRefresh((value) => value + 1);
			} else if (!result.ok)
				setError(result.error === "stalePreview" ? "stalePreview" : "failed");
		} catch {
			setError("failed");
			setPreview(null);
		} finally {
			applying.current = false;
			setBusy(false);
		}
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("title")}</CardTitle>
				<CardDescription>{t("description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<label className="text-sm" htmlFor="integrity-catalog">
						{t("catalog")}
					</label>
					<select
						id="integrity-catalog"
						value={catalog}
						disabled={busy}
						onChange={(event) => {
							setCatalog(event.target.value as IntegrityCatalog);
							setApplied(null);
						}}
						className="rounded-md border bg-[var(--admin-surface)] p-2 text-sm"
					>
						<option value="normal">{t("normal")}</option>
						<option value="bc">{t("bc")}</option>
					</select>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => setRefresh((value) => value + 1)}
					>
						{t("refresh")}
					</Button>
				</div>
				{busy && <p role="status">{t("working")}</p>}
				{error && (
					<p role="alert" className="text-destructive">
						{t(error)}
					</p>
				)}
				{applied !== null && (
					<p role="status">{t("applied", { count: applied })}</p>
				)}
				{report && (
					<>
						{!report.iconsAvailable && (
							<p role="status" className="text-sm">
								{t("iconsUnavailable")}
							</p>
						)}
						<p className="text-sm">
							{report.total === 0
								? t("healthy")
								: t("total", {
										count: report.total,
										shown: report.issues.length,
									})}
						</p>
						<div className="flex flex-wrap gap-2">
							{Object.entries(report.counts).map(([code, count]) => (
								<span
									key={code}
									className="rounded-md border px-2 py-1 text-xs"
								>
									{t(`issues.${code}`)}: {count}
								</span>
							))}
						</div>
						{report.issues.length > 0 && (
							<ul className="m-0 max-h-80 list-none space-y-2 overflow-y-auto p-0">
								{report.issues.map((issue) => (
									<li
										key={`${issue.code}-${issue.id}`}
										className="rounded-md border p-3 text-sm"
									>
										<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
											<span className="min-w-0 break-all font-medium">
												{t(`issues.${issue.code}`)} · #{issue.id} {issue.name}
											</span>
											<Link href={issue.href}>{t("open")}</Link>
										</div>
										<p className="m-0 break-all text-xs text-muted-foreground">
											{t("reference", { value: issue.detail })}
										</p>
									</li>
								))}
							</ul>
						)}
					</>
				)}
				{canRepair && (
					<div className="space-y-3 rounded-md border p-3">
						<p className="m-0 text-sm">{t("repairHint")}</p>
						<Button
							variant="outline"
							disabled={busy || !report}
							onClick={() => void prepare()}
						>
							{t("preview")}
						</Button>
						{preview && (
							<>
								<p className="m-0 text-sm">
									{t("planned", { count: preview.changes.length })}
								</p>
								<ul className="m-0 max-h-60 overflow-y-auto pl-5 text-sm">
									{preview.changes.map((change) => (
										<li key={change.id} className="break-all">
											#{change.id} {change.caption}:{" "}
											{t("parentChange", { from: change.from })}
										</li>
									))}
								</ul>
								<Button
									disabled={busy || preview.changes.length === 0}
									onClick={() => void apply()}
								>
									{t("apply")}
								</Button>
							</>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
