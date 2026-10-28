"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { deletePoll } from "@/actions/polls";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface PollRow {
	id: number;
	title: string;
	status: string;
	showResults: number;
	multipleChoice: number;
	startsAt: Date | null;
	endsAt: Date | null;
	createdAt: Date;
}

const statusVariants: Record<string, "default" | "secondary" | "outline"> = {
	active: "default",
	draft: "secondary",
	closed: "outline",
};

interface PollsTableProps {
	data: PaginatedResult<PollRow>;
}

export function PollsTable({ data }: PollsTableProps) {
	const t = useTranslations("pages.admin.polls");
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	const statusLabel: Record<string, string> = {
		active: t("statusActive"),
		draft: t("statusDraft"),
		closed: t("statusClosed"),
	};

	async function handleDelete(row: PollRow) {
		const ok = await confirm({
			title: "Delete poll",
			description: `Delete "${row.title}"? This cannot be undone.`,
			confirmLabel: "Delete",
			cancelLabel: "Cancel",
		});
		if (!ok) return;
		run(() => deletePoll({ id: row.id }), {
			successMessage: "Poll deleted!",
			errorMessage: "Failed to delete poll.",
		});
	}

	const columns: DataTableColumn<PollRow>[] = [
		{ key: "id", label: t("colId"), sortable: true },
		{
			key: "title",
			label: t("colTitle"),
			sortable: true,
			render: (value) => <span className="font-medium">{String(value)}</span>,
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
			key: "multipleChoice",
			label: t("colType"),
			render: (value) => (
				<span className="text-sm">
					{Number(value) ? t("typeMultiple") : t("typeSingle")}
				</span>
			),
		},
		{
			key: "createdAt",
			label: t("colCreated"),
			sortable: true,
			render: (value) => (
				<span className="text-sm">
					{formatDate(new Date(value as unknown as string), "date")}
				</span>
			),
		},
		{
			key: "actions",
			label: t("colActions"),
			render: (_, row) => (
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/admin/polls/${row.id}`}>
							<Pencil className="h-4 w-4" />
						</Link>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={isPending}
						onClick={() => handleDelete(row)}
						aria-label="Delete poll"
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
