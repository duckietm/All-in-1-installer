"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface TransactionRow {
	id: number;
	payer: string;
	payerId: number;
	amount: string;
	package: string;
	status: string;
	statusKind: "ok" | "danger" | "neutral";
	transactionId: string;
	date: string;
}

function statusVariant(
	kind: TransactionRow["statusKind"],
): "default" | "destructive" | "secondary" {
	if (kind === "ok") return "default";
	if (kind === "danger") return "destructive";
	return "secondary";
}

export function TransactionsTable({
	data,
}: {
	data: PaginatedResult<TransactionRow>;
}) {
	const t = useTranslations("pages.admin.transactions");

	const columns: DataTableColumn<TransactionRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{
			key: "payer",
			label: t("colPayer"),
			sortable: true,
			render: (_value, row) => (
				<Link
					href={`/admin/users/${row.payerId}`}
					className="font-medium hover:underline"
				>
					{row.payer}
				</Link>
			),
		},
		{ key: "amount", label: t("colAmount"), sortable: true },
		{ key: "package", label: t("colPackage"), sortable: true },
		{
			key: "status",
			label: t("colStatus"),
			sortable: true,
			filterKey: "filter_status",
			filterOptions: [
				{ label: t("statusCompleted"), value: "paid" },
				{ label: t("statusPending"), value: "pending" },
				{ label: t("statusFailed"), value: "failed" },
			],
			render: (_value, row) =>
				row.status ? (
					<Badge
						variant={statusVariant(row.statusKind)}
						className="font-mono text-[0.7rem]"
					>
						{row.status}
					</Badge>
				) : (
					<span className="text-muted-foreground">—</span>
				),
		},
		{ key: "transactionId", label: t("colTransaction") },
		{ key: "date", label: t("colDate"), sortable: true },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{ label: t("presetPaid"), params: { filter_status: "paid" } },
				{ label: t("presetFailed"), params: { filter_status: "failed" } },
			]}
		/>
	);
}
