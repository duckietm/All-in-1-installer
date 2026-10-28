"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import type { TicketInboxRow } from "@/lib/admin/ticket-inbox";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export function UnifiedTicketsTable({
	data,
}: {
	data: PaginatedResult<TicketInboxRow>;
}) {
	const t = useTranslations("pages.admin.ticketInbox");

	const columns: DataTableColumn<TicketInboxRow>[] = [
		{
			key: "title",
			label: t("colTicket"),
			sortable: false,
			render: (_value, row) => (
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<Badge
							variant={row.kind === "cms" ? "default" : "outline"}
							className="shrink-0 text-[0.65rem]"
						>
							{row.kind === "cms" ? t("typeCms") : t("typeHelp")}
						</Badge>
						<span className="text-xs text-muted-foreground font-mono">
							#{row.id}
						</span>
						<Link
							href={row.href}
							className="font-medium truncate hover:underline"
						>
							{row.title}
						</Link>
					</div>
					<div className="text-xs text-muted-foreground">
						{t("meta", { user: row.user })}
					</div>
				</div>
			),
		},
		{
			key: "status",
			label: t("colStatus"),
			sortable: false,
			filterKey: "filter_status",
			filterOptions: [
				{ label: t("statusOpen"), value: "open" },
				{ label: t("statusAll"), value: "all" },
			],
			render: (_value, row) => (
				<Badge
					variant={row.open ? "default" : "secondary"}
					className="text-[0.7rem] capitalize"
				>
					{row.kind === "cms"
						? row.status.replace("_", " ")
						: row.open
							? t("statusOpen")
							: t("statusClosed")}
				</Badge>
			),
		},
		{
			key: "kind",
			label: t("colType"),
			sortable: false,
			filterKey: "filter_type",
			filterOptions: [
				{ label: t("typeAll"), value: "all" },
				{ label: t("typeCms"), value: "cms" },
				{ label: t("typeHelp"), value: "help" },
			],
			render: (value) => {
				const kind = String(value);
				return (
					<span className="text-xs text-muted-foreground">
						{kind === "cms" ? t("typeCms") : t("typeHelp")}
					</span>
				);
			},
		},
		{ key: "date", label: t("colUpdated"), sortable: false },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{
					label: t("presetOpen"),
					params: { filter_status: "open", filter_type: "all" },
				},
				{
					label: t("typeCms"),
					params: { filter_type: "cms", filter_status: "open" },
				},
				{
					label: t("typeHelp"),
					params: { filter_type: "help", filter_status: "open" },
				},
				{
					label: t("statusAll"),
					params: { filter_status: "all", filter_type: "all" },
				},
			]}
		/>
	);
}
