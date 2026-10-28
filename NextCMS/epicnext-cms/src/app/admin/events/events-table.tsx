"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { deleteEvent } from "@/actions/events";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface EventRow {
	id: number;
	title: string;
	typeName: string;
	typeColor: string;
	startsAt: Date;
	endsAt: Date | null;
	status: string;
	hostUserId: number;
}

const statusVariants: Record<
	string,
	"default" | "secondary" | "outline" | "destructive"
> = {
	published: "default",
	draft: "secondary",
	cancelled: "destructive",
	completed: "outline",
};

interface EventsTableProps {
	data: PaginatedResult<EventRow>;
}

export function EventsTable({ data }: EventsTableProps) {
	const t = useTranslations("pages.admin.events");
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	const statusLabel: Record<string, string> = {
		published: t("statusPublished"),
		draft: t("statusDraft"),
		cancelled: t("statusCancelled"),
		completed: t("statusCompleted"),
	};

	async function handleDelete(row: EventRow) {
		const ok = await confirm({
			title: "Delete event",
			description: `Delete "${row.title}"? This cannot be undone.`,
			confirmLabel: "Delete",
			cancelLabel: "Cancel",
		});
		if (!ok) return;
		run(() => deleteEvent({ id: row.id }), {
			successMessage: "Event deleted!",
			errorMessage: "Failed to delete event.",
		});
	}

	const columns: DataTableColumn<EventRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{
			key: "title",
			label: t("colTitle"),
			sortable: true,
			render: (value) => <span className="font-medium">{String(value)}</span>,
		},
		{
			key: "typeName",
			label: t("colType"),
			sortable: false,
			render: (_, row) => (
				<Badge style={{ backgroundColor: row.typeColor, color: "#fff" }}>
					{row.typeName}
				</Badge>
			),
		},
		{
			key: "startsAt",
			label: t("colStarts"),
			sortable: true,
			render: (value) => (
				<span className="text-sm">
					{formatDate(new Date(value as unknown as string))}
				</span>
			),
		},
		{
			key: "status",
			label: t("colStatus"),
			sortable: true,
			render: (value) => {
				const key = String(value);
				return (
					<Badge variant={statusVariants[key] ?? "secondary"}>
						{statusLabel[key] ?? key}
					</Badge>
				);
			},
		},
		{
			key: "actions",
			label: t("colActions"),
			render: (_, row) => (
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/admin/events/${row.id}`}>
							<Pencil className="h-4 w-4" />
						</Link>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={isPending}
						onClick={() => handleDelete(row)}
						aria-label="Delete event"
					>
						<Trash2 className="h-4 w-4 text-destructive" />
					</Button>
				</div>
			),
		},
	];

	return (
		<>
			<DataTable
				data={data}
				columns={columns}
				searchPlaceholder={t("searchPlaceholder")}
			/>
			{confirmDialog}
		</>
	);
}
