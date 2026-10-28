"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import { formatDate } from "@/lib/format-date";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface ChatLogRow {
	id: number;
	username: string;
	message: string;
	timestamp: number;
	roomId: number;
}

interface ChatTableProps {
	data: PaginatedResult<ChatLogRow>;
}

export function ChatTable({ data }: ChatTableProps) {
	const t = useTranslations("pages.admin.logs");

	const columns: DataTableColumn<ChatLogRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{ key: "username", label: t("colUser") },
		{
			key: "message",
			label: t("chat.colMessage"),
			render: (value) => (
				<span className="max-w-[300px] truncate block">{String(value)}</span>
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
		{ key: "roomId", label: t("chat.colRoomId"), sortable: true },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("chat.searchPlaceholder")}
			exportUrl="/cms_api/admin/export?type=chatlogs"
		/>
	);
}
