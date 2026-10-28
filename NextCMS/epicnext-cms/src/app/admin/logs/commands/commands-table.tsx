"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import { formatDate } from "@/lib/format-date";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface CommandLogRow {
	id: number;
	username: string;
	command: string;
	params: string;
	timestamp: number;
}

interface CommandsTableProps {
	data: PaginatedResult<CommandLogRow>;
}

export function CommandsTable({ data }: CommandsTableProps) {
	const t = useTranslations("pages.admin.logs");

	const columns: DataTableColumn<CommandLogRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{ key: "username", label: t("colUser") },
		{ key: "command", label: t("commands.colCommand"), sortable: true },
		{
			key: "params",
			label: t("commands.colParams"),
			render: (value) => (
				<span className="max-w-[200px] truncate block font-mono text-sm">
					{String(value) || t("emptyValue")}
				</span>
			),
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
			searchPlaceholder={t("commands.searchPlaceholder")}
			exportUrl="/cms_api/admin/export?type=commands"
		/>
	);
}
