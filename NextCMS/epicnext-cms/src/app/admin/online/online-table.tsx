"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { avatarImageOnError, getAvatarUrl } from "@/lib/imager";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface OnlineUserRow {
	id: number;
	username: string;
	motto: string;
	look: string;
}

const columns: DataTableColumn<OnlineUserRow>[] = [
	{ key: "id", label: "ID", sortable: true },
	{
		key: "username",
		label: "Username",
		sortable: true,
		render: (_, row) => (
			<div className="flex items-center gap-2">
				<img
					src={getAvatarUrl(row.look, { size: "s", headOnly: true })}
					alt=""
					onError={avatarImageOnError}
					className="h-8 w-8 rounded"
				/>
				<span className="font-medium">{row.username}</span>
				<span className="relative flex h-2 w-2">
					<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--admin-success)]/70 opacity-75" />
					<span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--admin-success)]" />
				</span>
			</div>
		),
	},
	{
		key: "motto",
		label: "Motto",
		render: (value) => (
			<span className="max-w-[250px] truncate block">
				{String(value) || "-"}
			</span>
		),
	},
	{
		key: "look",
		label: "Avatar",
		render: (_, row) => (
			<img
				src={getAvatarUrl(row.look)}
				alt={row.username}
				onError={avatarImageOnError}
				className="h-16"
			/>
		),
	},
];

interface OnlineTableProps {
	data: PaginatedResult<OnlineUserRow>;
}

const REFRESH_INTERVAL = 15_000; // 15 seconds

export function OnlineTable({ data }: OnlineTableProps) {
	const router = useRouter();
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [lastUpdated, setLastUpdated] = useState(() => new Date());
	const [isRefreshing, setIsRefreshing] = useState(false);

	const doRefresh = useCallback(() => {
		setIsRefreshing(true);
		router.refresh();
		setLastUpdated(new Date());
		// Small delay to show spinner
		setTimeout(() => setIsRefreshing(false), 500);
	}, [router]);

	useEffect(() => {
		if (!autoRefresh) return;
		const timer = setInterval(doRefresh, REFRESH_INTERVAL);
		return () => clearInterval(timer);
	}, [autoRefresh, doRefresh]);

	// Update lastUpdated when data changes
	useEffect(() => {
		setLastUpdated(new Date());
	}, []);

	return (
		<div className="space-y-4">
			{/* Auto-refresh controls */}
			<div className="flex items-center gap-3 text-sm">
				<Button
					variant="outline"
					size="sm"
					onClick={doRefresh}
					disabled={isRefreshing}
				>
					<RefreshCw
						className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
					/>
					Refresh
				</Button>
				<Button
					variant={autoRefresh ? "default" : "outline"}
					size="sm"
					onClick={() => setAutoRefresh(!autoRefresh)}
				>
					{autoRefresh ? (
						<>
							<Pause className="mr-1.5 h-3.5 w-3.5" /> Auto-refresh ON
						</>
					) : (
						<>
							<Play className="mr-1.5 h-3.5 w-3.5" /> Auto-refresh OFF
						</>
					)}
				</Button>
				{autoRefresh && (
					<Badge variant="secondary" className="text-xs">
						Every {REFRESH_INTERVAL / 1000}s
					</Badge>
				)}
				<span className="text-xs text-muted-foreground ml-auto">
					Last updated: {formatDate(lastUpdated, "time")}
				</span>
			</div>

			<DataTable
				data={data}
				columns={columns}
				searchPlaceholder="Search by username or motto..."
			/>
		</div>
	);
}
