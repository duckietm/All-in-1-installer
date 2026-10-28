"use client";

import { Eye, Pencil, Sofa, Wifi } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface RoomRow {
	id: number;
	name: string;
	ownerName: string;
	ownerId: number;
	state: string;
	users: number;
	usersMax: number;
	description: string;
}

const stateVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	open: "default",
	locked: "secondary",
	password: "destructive",
	invisible: "outline",
};

function getColumns(canEdit: boolean): DataTableColumn<RoomRow>[] {
	return [
		{ key: "id", label: "ID", sortable: true },
		{
			key: "name",
			label: "Room",
			sortable: true,
			render: (_, row) => (
				<Link href={`/admin/rooms/show/${row.id}`} className="hover:opacity-80">
					<div className="min-w-0">
						<span className="font-medium block">{row.name}</span>
						{row.description && (
							<span className="text-xs text-muted-foreground truncate block max-w-[250px]">
								{row.description}
							</span>
						)}
					</div>
				</Link>
			),
		},
		{
			key: "ownerName",
			label: "Owner",
			render: (_, row) => (
				<Link
					href={`/admin/users/show/${row.ownerId}`}
					className="text-sm text-primary hover:underline"
				>
					{row.ownerName}
				</Link>
			),
		},
		{
			key: "state",
			label: "State",
			sortable: true,
			filterKey: "filter_state",
			filterOptions: [
				{ label: "Open", value: "open" },
				{ label: "Locked", value: "locked" },
				{ label: "Password", value: "password" },
				{ label: "Invisible", value: "invisible" },
			],
			render: (value) => (
				<Badge variant={stateVariants[String(value)] || "outline"}>
					{String(value)}
				</Badge>
			),
		},
		{
			key: "users",
			label: "Users",
			sortable: true,
			render: (_, row) => (
				<span className="flex items-center gap-1.5 text-sm">
					{row.users > 0 && (
						<Wifi className="h-3 w-3 text-[var(--admin-success)]" />
					)}
					<span
						className={row.users > 0 ? "font-medium" : "text-muted-foreground"}
					>
						{row.users}
					</span>
					<span className="text-muted-foreground">/ {row.usersMax}</span>
				</span>
			),
		},
		{
			key: "actions",
			label: "",
			render: (_, row) => (
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/admin/rooms/show/${row.id}`}>
							<Eye className="h-4 w-4" />
						</Link>
					</Button>
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/admin/rooms/${row.id}/furni`}>
							<Sofa className="h-4 w-4" />
						</Link>
					</Button>
					{canEdit && (
						<Button variant="ghost" size="icon" asChild>
							<Link href={`/admin/rooms/edit/${row.id}`}>
								<Pencil className="h-4 w-4" />
							</Link>
						</Button>
					)}
				</div>
			),
		},
	];
}

interface RoomsTableProps {
	data: PaginatedResult<RoomRow>;
	canEdit: boolean;
}

export function RoomsTable({ data, canEdit }: RoomsTableProps) {
	return (
		<DataTable
			data={data}
			columns={getColumns(canEdit)}
			searchPlaceholder="Search by room name or owner..."
			exportUrl={canEdit ? "/api/admin/export?type=rooms" : undefined}
		/>
	);
}
