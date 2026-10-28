"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface HelpTicketRow {
	id: string;
	title: string;
	user: string;
	userId: number | null;
	replies: number;
	open: boolean;
	date: string;
	updated: string;
}

export function HelpTicketsTable({
	data,
	basePath = "/admin/help-tickets",
}: {
	data: PaginatedResult<HelpTicketRow>;
	basePath?: string;
}) {
	const t = useTranslations("pages.admin.helpTickets");

	const columns: DataTableColumn<HelpTicketRow>[] = [
		{
			key: "title",
			label: t("colTicket"),
			sortable: true,
			render: (_value, row) => (
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground font-mono">
							#{row.id}
						</span>
						<Link
							href={`${basePath}/${row.id}`}
							className="font-medium truncate hover:underline"
						>
							{row.title}
						</Link>
					</div>
					<div className="text-xs text-muted-foreground">
						{t("meta", { user: row.user, count: row.replies })}
					</div>
				</div>
			),
		},
		{
			key: "open",
			label: t("colStatus"),
			sortable: true,
			filterKey: "filter_status",
			filterOptions: [
				{ label: t("presetOpen"), value: "open" },
				{ label: t("statusClosed"), value: "closed" },
			],
			render: (value) => {
				const open = value === true || value === "true";
				return (
					<Badge
						variant={open ? "default" : "secondary"}
						className="text-[0.7rem]"
					>
						{open ? t("statusOpen") : t("statusClosed")}
					</Badge>
				);
			},
		},
		{ key: "user", label: t("colUser"), sortable: true },
		{ key: "date", label: t("colCreated"), sortable: true },
		{ key: "updated", label: t("colUpdated"), sortable: true },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{ label: t("presetOpen"), params: { filter_status: "open" } },
				{ label: t("statusClosed"), params: { filter_status: "closed" } },
				{ label: t("presetAll"), params: { filter_status: "all" } },
			]}
		/>
	);
}
