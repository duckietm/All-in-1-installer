"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface TradeLogRow {
	id: number;
	userOneName: string;
	userTwoName: string;
	status: string;
	timestamp: number;
}

interface TradesTableProps {
	data: PaginatedResult<TradeLogRow>;
}

export function TradesTable({ data }: TradesTableProps) {
	const t = useTranslations("pages.admin.logs");

	const columns: DataTableColumn<TradeLogRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{ key: "userOneName", label: t("trades.colUserOne") },
		{ key: "userTwoName", label: t("trades.colUserTwo") },
		{
			key: "status",
			label: t("trades.colStatus"),
			sortable: true,
			render: (value) => {
				const v = String(value);
				const variant =
					v === "completed"
						? "default"
						: v === "cancelled"
							? "destructive"
							: "secondary";
				return (
					<Badge variant={variant}>{v || t("trades.statusUnknown")}</Badge>
				);
			},
		},
		{
			key: "timestamp",
			label: t("colTime"),
			sortable: true,
			render: (value) => (
				<span>{formatDate(new Date(Number(value) * 1000))}</span>
			),
		},
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("trades.searchPlaceholder")}
		/>
	);
}
