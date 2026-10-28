"use client";

import { Eye, Package, Pencil } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

export interface ItemsBaseRow {
	id: number;
	spriteId: number;
	publicName: string;
	itemName: string;
	type: string;
	interactionType: string;
	width: number;
	length: number;
}

function getColumns(canEdit: boolean): DataTableColumn<ItemsBaseRow>[] {
	return [
		{ key: "id", label: "ID", sortable: true },
		{
			key: "publicName",
			label: "Name",
			sortable: true,
			render: (_, row) => (
				<Link
					href={`/admin/items/${row.id}`}
					className="hover:opacity-80 flex items-center gap-2 min-w-0"
				>
					<Package className="h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<span className="font-medium block truncate">
							{row.publicName || "—"}
						</span>
						<span className="text-xs text-muted-foreground font-mono truncate block">
							{row.itemName}
						</span>
					</div>
				</Link>
			),
		},
		{
			key: "spriteId",
			label: "Sprite",
			sortable: true,
			render: (v) => <span className="tabular-nums text-sm">{String(v)}</span>,
		},
		{
			key: "type",
			label: "Type",
			sortable: true,
			filterKey: "filter_type",
			filterOptions: [
				{ label: "Floor (s)", value: "s" },
				{ label: "Wall (i)", value: "i" },
				{ label: "Effect (e)", value: "e" },
				{ label: "Badge (b)", value: "b" },
				{ label: "Robot (r)", value: "r" },
			],
			render: (v) => <Badge variant="outline">{String(v)}</Badge>,
		},
		{
			key: "interactionType",
			label: "Interaction",
			sortable: true,
			render: (v) => (
				<span className="text-xs font-mono text-muted-foreground">
					{String(v || "default")}
				</span>
			),
		},
		{
			key: "width",
			label: "Size",
			render: (_, row) => (
				<span className="tabular-nums text-sm">
					{row.width}×{row.length}
				</span>
			),
		},
		{
			key: "actions",
			label: "",
			render: (_, row) => (
				<div className="flex gap-1 justify-end">
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/admin/items/${row.id}`} aria-label="View">
							{canEdit ? (
								<Pencil className="h-4 w-4" />
							) : (
								<Eye className="h-4 w-4" />
							)}
						</Link>
					</Button>
				</div>
			),
		},
	];
}

export function ItemsTable({
	data,
	canEdit,
}: {
	data: PaginatedResult<ItemsBaseRow>;
	canEdit: boolean;
}) {
	return (
		<DataTable
			columns={getColumns(canEdit)}
			data={data}
			searchPlaceholder="Search name, classname or ID…"
		/>
	);
}
