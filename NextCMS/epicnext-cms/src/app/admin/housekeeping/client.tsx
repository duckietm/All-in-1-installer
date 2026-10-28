"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { exportPermissions } from "@/actions/admin-housekeeping";
import { Button } from "@/components/ui/button";

/* ────────── Export Section ────────── */

export function ExportSection() {
	const t = useTranslations("pages.admin.housekeeping");
	const [data, setData] = useState<string | null>(null);
	const [copying, setCopying] = useState(false);
	const [exporting, setExporting] = useState(false);

	const handleExport = useCallback(async () => {
		setExporting(true);
		try {
			const json = await exportPermissions();
			setData(json);
		} finally {
			setExporting(false);
		}
	}, []);

	const handleCopy = useCallback(async () => {
		if (!data) return;
		setCopying(true);
		try {
			await navigator.clipboard.writeText(data);
		} catch {
			/* fallback */
		}
		setTimeout(() => setCopying(false), 1500);
	}, [data]);

	return (
		<section>
			<h2 className="admin-section-title">{t("exportTitle")}</h2>
			<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
				{t("exportHint")}
			</p>
			<div>
				<Button
					type="button"
					onClick={handleExport}
					disabled={exporting}
					variant="outline"
					className="mb-3"
				>
					{exporting ? t("loading") : t("export")}
				</Button>
				{data && (
					<div className="relative">
						<pre className="admin-card font-mono text-xs overflow-auto max-h-[300px] p-3">
							{data}
						</pre>
						<Button
							type="button"
							onClick={handleCopy}
							variant="outline"
							size="sm"
							className="absolute top-2 right-2"
						>
							{copying ? t("copied") : t("copy")}
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}

/* ────────── Audit Section ────────── */

interface AuditEntry {
	id: number;
	userId: number;
	username: string | null;
	action: string;
	target: string;
	targetId: number | null;
	createdAt: string;
}

interface AuditSectionProps {
	initialLogs: {
		rows: AuditEntry[];
		total: number;
		page: number;
		perPage: number;
		lastPage: number;
	} | null;
}

export function AuditSection({ initialLogs }: AuditSectionProps) {
	const t = useTranslations("pages.admin.housekeeping");
	const locale = useLocale();
	const router = useRouter();
	const dateFmt = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				dateStyle: "short",
				timeStyle: "short",
			}),
		[locale],
	);

	if (!initialLogs || initialLogs.rows.length === 0) {
		return (
			<section>
				<h2 className="admin-section-title">{t("auditTitle")}</h2>
				<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
					{t("auditHint")}
				</p>
				<div className="admin-card">
					<p className="text-sm opacity-70">{t("auditLogsAt")}</p>
					<Button
						type="button"
						onClick={() => router.push("/admin/logs/audit")}
						variant="outline"
						className="mt-2"
					>
						{t("viewAuditLogs")}
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section>
			<h2 className="admin-section-title">{t("auditTitle")}</h2>
			<p className="text-xs text-[var(--admin-text-muted)] -mt-2 mb-3">
				{t("auditHint")}
			</p>
			<div className="overflow-x-auto">
				<table>
					<thead>
						<tr>
							<th className="w-[160px]">{t("auditTime")}</th>
							<th className="w-[120px]">{t("auditUser")}</th>
							<th>{t("auditAction")}</th>
							<th>{t("auditTarget")}</th>
						</tr>
					</thead>
					<tbody>
						{initialLogs.rows.map((log) => (
							<tr key={log.id}>
								<td className="text-xs whitespace-nowrap">
									{dateFmt.format(new Date(log.createdAt))}
								</td>
								<td className="text-xs">{log.username ?? "System"}</td>
								<td className="text-xs font-mono">{log.action}</td>
								<td className="text-xs">
									{log.target}
									{log.targetId != null ? ` #${log.targetId}` : ""}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-3 text-xs opacity-60 text-center">
				{t("auditLogsAt")}{" "}
				<button
					type="button"
					onClick={() => router.push("/admin/logs/audit")}
					className="underline hover:no-underline"
				>
					{t("viewAuditLogs")}
				</button>
			</div>
		</section>
	);
}
