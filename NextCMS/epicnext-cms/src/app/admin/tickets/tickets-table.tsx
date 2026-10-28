"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface TicketRow {
	id: number;
	subject: string;
	creator: string;
	creatorId: number;
	category: string;
	messages: number;
	status: string;
	priority: string;
	assignee: string;
	date: string;
	awaitingStaff: boolean;
	replyAgeMinutes: number | null;
}

const STATUS_VARIANT: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	open: "default",
	in_progress: "secondary",
	waiting: "outline",
	closed: "secondary",
};

export function TicketsTable({
	data,
	basePath = "/admin/tickets",
}: {
	data: PaginatedResult<TicketRow>;
	basePath?: string;
}) {
	const t = useTranslations("pages.admin.tickets");

	const statusLabel: Record<string, string> = {
		open: t("statusOpen"),
		in_progress: t("statusInProgress"),
		waiting: t("statusWaiting"),
		closed: t("statusClosed"),
	};

	const columns: DataTableColumn<TicketRow>[] = [
		{
			key: "subject",
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
							{row.subject}
						</Link>
					</div>
					<div className="text-xs text-muted-foreground">
						{t("meta", {
							user: row.creator,
							count: row.messages,
							category: row.category,
						})}
					</div>
				</div>
			),
		},
		{
			key: "status",
			label: t("colStatus"),
			sortable: true,
			filterKey: "filter_status",
			filterOptions: [
				{ label: t("awaitingStaff"), value: "awaiting_staff" },
				{ label: t("statusOpen"), value: "open" },
				{ label: t("statusInProgress"), value: "in_progress" },
				{ label: t("statusWaiting"), value: "waiting" },
				{ label: t("statusClosed"), value: "closed" },
			],
			render: (value) => {
				const status = String(value);
				return (
					<Badge
						variant={STATUS_VARIANT[status] ?? "secondary"}
						className="text-[0.7rem]"
					>
						{statusLabel[status] ?? status.replace("_", " ")}
					</Badge>
				);
			},
		},
		{
			key: "priority",
			label: t("colPriority"),
			sortable: true,
			render: (value) => {
				const p = String(value);
				const className =
					p === "urgent"
						? "text-[var(--admin-error)] font-bold"
						: p === "high"
							? "text-[var(--admin-warning)]"
							: p === "normal"
								? "text-[var(--admin-info)]"
								: "";
				return <span className={`text-xs capitalize ${className}`}>{p}</span>;
			},
		},
		{
			key: "assignee",
			label: t("colAssigned"),
			sortable: true,
			filterKey: "filter_assignee",
			filterOptions: [
				{ label: t("assignedMine"), value: "mine" },
				{ label: t("unassigned"), value: "unassigned" },
				{ label: t("assignedAny"), value: "assigned" },
			],
		},
		{
			key: "replyAgeMinutes",
			label: t("lastReplyAge"),
			render: (_value, row) => (
				<div>
					{row.awaitingStaff && (
						<Badge variant="outline">{t("awaitingStaff")}</Badge>
					)}
					<div className="text-xs text-muted-foreground">
						{row.replyAgeMinutes === null
							? "—"
							: row.replyAgeMinutes < 60
								? t("ageMinutes", { count: row.replyAgeMinutes })
								: row.replyAgeMinutes < 1440
									? t("ageHours", {
											count: Math.floor(row.replyAgeMinutes / 60),
										})
									: t("ageDays", {
											count: Math.floor(row.replyAgeMinutes / 1440),
										})}
					</div>
				</div>
			),
		},
		{ key: "date", label: t("colDate"), sortable: true },
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{
					label: t("awaitingStaff"),
					params: { filter_status: "awaiting_staff", filter_assignee: "" },
				},
				{
					label: t("assignedMine"),
					params: { filter_status: "active", filter_assignee: "mine" },
				},
				{ label: t("presetActive"), params: { filter_status: "active" } },
				{ label: t("statusOpen"), params: { filter_status: "open" } },
				{
					label: t("statusInProgress"),
					params: { filter_status: "in_progress" },
				},
				{ label: t("statusWaiting"), params: { filter_status: "waiting" } },
				{ label: t("statusClosed"), params: { filter_status: "closed" } },
			]}
		/>
	);
}
