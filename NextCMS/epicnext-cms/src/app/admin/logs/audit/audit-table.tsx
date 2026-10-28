"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { HistoryRestore } from "@/features/history/history-restore";
import { formatAuditValue, readAuditChanges } from "@/lib/services/audit-diff";
import type { DataTableColumn, PaginatedResult } from "@/types/common";
import { AuditFilters } from "./audit-filters";

interface AuditRow {
	operationId?: string | null;
	id: number;
	username: string;
	action: string;
	target: string;
	targetId: number | null;
	diff: string | null;
	before: string | null;
	after: string | null;
	createdAt: string;
}

function DiffCell({ row }: { row: AuditRow }) {
	const t = useTranslations("pages.admin.logs");
	const { changes, invalid } = readAuditChanges(
		row.diff,
		row.before,
		row.after,
	);
	if (invalid)
		return (
			<span className="text-muted-foreground text-xs">
				{t("audit.invalidDetails")}
			</span>
		);
	if (!changes.length)
		return <span className="text-muted-foreground">{t("emptyValue")}</span>;
	return (
		<details className="max-w-xl text-xs">
			<summary className="cursor-pointer font-medium">
				{t("audit.changesCount", { count: changes.length })}
			</summary>
			<div className="mt-2 space-y-3">
				{changes.map((change) => (
					<div key={change.key} className="space-y-1">
						<p className="font-medium break-all">{change.key}</p>
						<div className="grid gap-2 sm:grid-cols-2">
							<div>
								<span className="text-muted-foreground">
									{t("audit.beforeValue")}
								</span>
								<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border p-2">
									{formatAuditValue(change.from)}
								</pre>
							</div>
							<div>
								<span className="text-muted-foreground">
									{t("audit.afterValue")}
								</span>
								<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border p-2">
									{formatAuditValue(change.to)}
								</pre>
							</div>
						</div>
					</div>
				))}
			</div>
		</details>
	);
}
interface AuditTableProps {
	data: PaginatedResult<AuditRow>;
}

export function AuditTable({ data }: AuditTableProps) {
	const params = useSearchParams();
	const t = useTranslations("pages.admin.logs");

	const columns: DataTableColumn<AuditRow>[] = [
		{ key: "id", label: t("colId") },
		{ key: "username", label: t("colUser") },
		{
			key: "action",
			label: t("colAction"),
			render: (value) => {
				const v = String(value);
				let variant: "default" | "secondary" | "destructive" = "secondary";
				if (v.includes("create") || v.includes("add")) variant = "default";
				if (v.includes("delete") || v.includes("remove") || v.includes("ban"))
					variant = "destructive";
				return <Badge variant={variant}>{v}</Badge>;
			},
		},
		{ key: "target", label: t("colTarget") },
		{
			key: "targetId",
			label: t("audit.colTargetId"),
			render: (value) => (
				<span>{value != null ? String(value) : t("emptyValue")}</span>
			),
		},
		{
			key: "diff",
			label: t("audit.colDetails"),
			render: (_value, row) => (
				<div className="space-y-2">
					<DiffCell row={row} />
					{row.operationId && (
						<Link
							className="text-xs underline break-all"
							href={`/admin/devops/cms-errors?q=${encodeURIComponent(row.operationId)}`}
						>
							{t("audit.operation")}: {row.operationId}
						</Link>
					)}
					{["history_update", "history_restore"].includes(row.action) && (
						<HistoryRestore id={row.id} />
					)}
				</div>
			),
		},
		{
			key: "createdAt",
			label: t("audit.colDate"),
			render: (value) => (
				<span>{String(value) || t("audit.notAvailable")}</span>
			),
		},
	];

	return (
		<div className="space-y-4">
			<AuditFilters />
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">{t("audit.exportHint")}</p>
				<div className="flex items-center gap-2">
					<a
						href={`/api/admin/logs/audit/export?${params.toString()}&format=csv`}
						className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
					>
						Export CSV
					</a>
					<a
						href={`/api/admin/logs/audit/export?${params.toString()}&format=json`}
						className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
					>
						Export JSON
					</a>
				</div>
			</div>
			<DataTable
				data={data}
				columns={columns}
				searchPlaceholder={t("audit.searchPlaceholder")}
			/>
		</div>
	);
}
