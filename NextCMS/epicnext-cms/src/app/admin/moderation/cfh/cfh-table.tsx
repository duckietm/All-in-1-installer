"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface CfhRow {
	id: number;
	issue: string;
	roomId: number;
	when: string;
	sender: string;
	senderId: number;
	reported: string;
	reportedId: number;
	mod: string;
	state: number;
	stateLabel: string;
}

export function CfhTable({
	data,
	basePath = "/admin/moderation/cfh",
	userLinkMode = "admin",
}: {
	data: PaginatedResult<CfhRow>;
	/** Detail URL prefix (no trailing slash). */
	basePath?: string;
	/** Admin user show vs public profile. */
	userLinkMode?: "admin" | "public";
}) {
	const t = useTranslations("pages.admin.cfh");

	function userHref(id: number, username: string) {
		if (userLinkMode === "public" && username && username !== "—") {
			return `/u/${encodeURIComponent(username)}`;
		}
		return `/admin/users/${id}`;
	}

	const columns: DataTableColumn<CfhRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{
			key: "issue",
			label: t("colIssue"),
			sortable: true,
			render: (_value, row) => (
				<div className="min-w-0">
					<Link
						href={`${basePath}/${row.id}`}
						className="text-sm font-medium truncate block hover:underline"
					>
						{row.issue || t("noDescription")}
					</Link>
					<p className="text-[10px] text-muted-foreground">
						{t("roomMeta", { room: row.roomId, when: row.when })}
					</p>
				</div>
			),
		},
		{
			key: "sender",
			label: t("colSender"),
			sortable: true,
			render: (_value, row) =>
				row.senderId ? (
					<Link
						href={userHref(row.senderId, row.sender)}
						className="hover:underline"
					>
						{row.sender}
					</Link>
				) : (
					"—"
				),
		},
		{
			key: "reported",
			label: t("colReported"),
			sortable: true,
			render: (_value, row) =>
				row.reportedId ? (
					<Link
						href={userHref(row.reportedId, row.reported)}
						className="font-medium hover:underline"
					>
						{row.reported}
					</Link>
				) : (
					"—"
				),
		},
		{ key: "mod", label: t("colMod"), sortable: true },
		{
			key: "state",
			label: t("colStatus"),
			sortable: true,
			filterKey: "filter_state",
			filterOptions: [
				{ label: t("stateOpen"), value: "0" },
				{ label: t("statePicked"), value: "1" },
				{ label: t("stateClosed"), value: "2" },
			],
			render: (_value, row) => {
				const variant =
					row.state === 0
						? "destructive"
						: row.state === 1
							? "default"
							: "secondary";
				return (
					<Badge variant={variant} className="text-[0.7rem]">
						{row.stateLabel}
					</Badge>
				);
			},
		},
	];

	return (
		<DataTable
			data={data}
			columns={columns}
			searchPlaceholder={t("searchPlaceholder")}
			presets={[
				{ label: t("stateOpen"), params: { filter_state: "0" } },
				{ label: t("statePicked"), params: { filter_state: "1" } },
				{ label: t("stateClosed"), params: { filter_state: "2" } },
			]}
		/>
	);
}
