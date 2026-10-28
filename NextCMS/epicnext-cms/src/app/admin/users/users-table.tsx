"use client";

import { Eye, Pencil, Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	bulkAdjustCurrency,
	bulkBan,
	bulkGiveBadge,
	bulkUnban,
} from "@/actions/bulk-users";
import { DataTable } from "@/components/admin/data-table";
import Link from "@/components/link";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatDate, formatNumber } from "@/lib/format-date";
import { avatarImageOnError, getAvatarUrl } from "@/lib/imager";
import type { DataTableColumn, PaginatedResult } from "@/types/common";

interface UserRow {
	id: number;
	username: string;
	mail: string | null;
	rank: number;
	credits: number;
	pixels: number;
	online: string;
	motto: string;
	look: string;
	ipRegister: string;
	accountCreated: number;
	lastLogin: number | null;
}

const RANK_LABELS: Record<number, string> = {
	1: "User",
	2: "Bronze",
	3: "Silver",
	4: "Gold",
	5: "Moderator",
	6: "Admin",
	7: "Super Admin",
};

function getColumns(canEdit: boolean): DataTableColumn<UserRow>[] {
	const cols: DataTableColumn<UserRow>[] = [
		{ key: "id", label: "ID", sortable: true },
		{
			key: "username",
			label: "User",
			sortable: true,
			render: (_, row) => (
				<Link
					href={`/admin/users/show/${row.id}`}
					className="flex items-center gap-2.5 hover:opacity-80"
				>
					<img
						src={getAvatarUrl(row.look, {
							size: "m",
							direction: 2,
							headDirection: 2,
						})}
						alt=""
						width={64}
						height={110}
						onError={avatarImageOnError}
						className="h-[110px] w-16 shrink-0"
						style={{ imageRendering: "pixelated" }}
					/>
					<div className="min-w-0">
						<span className="font-medium block">{row.username}</span>
						{row.motto && (
							<span className="text-xs text-muted-foreground truncate block max-w-[200px]">
								{row.motto}
							</span>
						)}
					</div>
				</Link>
			),
		},
		{ key: "mail", label: "Email", sortable: true },
		{
			key: "rank",
			label: "Rank",
			sortable: true,
			filterKey: "filter_rank",
			filterOptions: [
				{ label: "User (1)", value: "1" },
				{ label: "Bronze (2)", value: "2" },
				{ label: "Silver (3)", value: "3" },
				{ label: "Gold (4)", value: "4" },
				{ label: "Moderator (5)", value: "5" },
				{ label: "Admin (6)", value: "6" },
				{ label: "Super Admin (7+)", value: "7" },
			],
			render: (value) => {
				const r = Number(value);
				return (
					<Badge
						variant={r >= 7 ? "default" : r >= 5 ? "secondary" : "outline"}
					>
						{RANK_LABELS[r] || `Rank ${r}`}
					</Badge>
				);
			},
		},
		{
			key: "credits",
			label: "Credits",
			sortable: true,
			render: (value) => (
				<span className="tabular-nums">{formatNumber(Number(value))}</span>
			),
		},
		{
			key: "online",
			label: "Status",
			filterKey: "filter_online",
			filterOptions: [
				{ label: "Online", value: "1" },
				{ label: "Offline", value: "0" },
			],
			render: (value) =>
				value === "1" ? (
					<span className="flex items-center gap-1.5 text-[var(--admin-success)]">
						<Wifi className="h-3.5 w-3.5" /> Online
					</span>
				) : (
					<span className="flex items-center gap-1.5 text-muted-foreground">
						<WifiOff className="h-3.5 w-3.5" /> Offline
					</span>
				),
		},
		{
			key: "accountCreated",
			label: "Registered",
			sortable: true,
			render: (value) => {
				const ts = Number(value);
				if (!ts) return "-";
				return (
					<span className="text-xs text-muted-foreground">
						{formatDate(new Date(ts * 1000), "date")}
					</span>
				);
			},
		},
		{
			key: "actions",
			label: "",
			render: (_, row) => (
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="icon" asChild title="View">
						<Link href={`/admin/users/show/${row.id}`}>
							<Eye className="h-4 w-4" />
						</Link>
					</Button>
					{canEdit && (
						<Button variant="ghost" size="icon" asChild title="Edit">
							<Link href={`/admin/users/edit/${row.id}`}>
								<Pencil className="h-4 w-4" />
							</Link>
						</Button>
					)}
				</div>
			),
		},
	];

	return cols;
}

interface UsersTableProps {
	data: PaginatedResult<UserRow>;
	canEdit: boolean;
	canBan: boolean;
}

type PendingDialog =
	| { kind: "ban"; ids: number[] }
	| { kind: "give-currency"; ids: number[] }
	| { kind: "give-badge"; ids: number[] }
	| null;

export function UsersTable({ data, canEdit, canBan }: UsersTableProps) {
	const [pending, setPending] = useState<PendingDialog>(null);
	const [busy, setBusy] = useState(false);
	const [banReason, setBanReason] = useState("Bulk ban");
	const [banDuration, setBanDuration] = useState("-1");
	const [currencyType, setCurrencyType] = useState<
		"credits" | "pixels" | "points"
	>("credits");
	const [currencyAmount, setCurrencyAmount] = useState("100");
	const [badgeCode, setBadgeCode] = useState("");

	function reportResult(
		label: string,
		ok: number,
		total: number,
		failures = 0,
	) {
		if (ok > 0)
			toast.success(
				`${label}: ${ok}/${total}${failures ? ` · ${failures} failed` : ""}`,
			);
		if (failures > 0 && ok === 0)
			toast.error(`${label} failed for ${failures} users`);
	}

	async function handleBulkAction(action: string, ids: (number | string)[]) {
		const numericIds = ids.map((i) => Number(i));

		if (action === "unban") {
			setBusy(true);
			try {
				const result = await bulkUnban({ userIds: numericIds });
				if (result.ok) {
					const data = result.data as { unbanned: number; total: number };
					reportResult("Unbanned", data.unbanned, data.total);
				} else toast.error(result.error);
			} finally {
				setBusy(false);
			}
			return;
		}

		if (action === "ban") {
			setPending({ kind: "ban", ids: numericIds });
			return;
		}

		if (action === "give-currency") {
			setPending({ kind: "give-currency", ids: numericIds });
			return;
		}

		if (action === "give-badge") {
			setPending({ kind: "give-badge", ids: numericIds });
			return;
		}
	}

	async function confirmBan() {
		if (pending?.kind !== "ban") return;
		setBusy(true);
		try {
			const result = await bulkBan({
				userIds: pending.ids,
				reason: banReason,
				duration: Number(banDuration),
			});
			if (result.ok) {
				const data = result.data as { banned: number };
				reportResult("Banned", data.banned, pending.ids.length);
			} else toast.error(result.error);
			setPending(null);
		} finally {
			setBusy(false);
		}
	}

	async function confirmGiveCurrency() {
		if (pending?.kind !== "give-currency") return;
		setBusy(true);
		try {
			const result = await bulkAdjustCurrency({
				userIds: pending.ids,
				amount: Number(currencyAmount),
				type: currencyType,
			});
			if (result.ok) {
				const data = result.data as {
					adjusted: number;
					total: number;
					failedIds: { userId: number; reason: string }[];
				};
				reportResult(
					`Adjusted ${currencyAmount} ${currencyType}`,
					data.adjusted,
					data.total,
					data.failedIds.length,
				);
			} else toast.error(result.error);
			setPending(null);
		} finally {
			setBusy(false);
		}
	}

	async function confirmGiveBadge() {
		if (pending?.kind !== "give-badge") return;
		setBusy(true);
		try {
			const result = await bulkGiveBadge({
				userIds: pending.ids,
				badgeCode: badgeCode.trim().toUpperCase(),
			});
			if (result.ok) {
				const data = result.data as {
					given: number;
					total: number;
					failedIds: { userId: number; reason: string }[];
				};
				reportResult(
					`Given badge ${badgeCode}`,
					data.given,
					data.total,
					data.failedIds.length,
				);
			} else toast.error(result.error);
			setPending(null);
		} finally {
			setBusy(false);
		}
	}

	const bulkActions: {
		label: string;
		value: string;
		variant?: "destructive" | "default";
	}[] = [];
	if (canBan) {
		bulkActions.push({ label: "Ban", value: "ban", variant: "destructive" });
		bulkActions.push({ label: "Unban", value: "unban" });
	}
	if (canEdit) {
		bulkActions.push({ label: "Adjust currency", value: "give-currency" });
		bulkActions.push({ label: "Give badge", value: "give-badge" });
	}

	return (
		<>
			<DataTable
				data={data}
				columns={getColumns(canEdit)}
				searchPlaceholder="Search by username, email or IP..."
				presets={[
					{ label: "Online now", params: { filter_online: "1" } },
					{ label: "Staff (rank ≥ 5)", params: { filter_rank: "5" } },
					{ label: "Super admins", params: { filter_rank: "7" } },
				]}
				bulkActions={bulkActions.length > 0 ? bulkActions : undefined}
				onBulkAction={bulkActions.length > 0 ? handleBulkAction : undefined}
				exportUrl={canEdit ? "/cms_api/admin/export?type=users" : undefined}
			/>

			<Dialog
				open={pending?.kind === "ban"}
				onOpenChange={(o) => !o && setPending(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Ban {pending?.kind === "ban" ? pending.ids.length : 0} users
						</DialogTitle>
						<DialogDescription>
							Permanent ban: leave duration at -1.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<div>
							<Label htmlFor="ban-reason">Reason</Label>
							<Input
								id="ban-reason"
								value={banReason}
								onChange={(e) => setBanReason(e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="ban-duration">
								Duration (seconds, -1 = permanent)
							</Label>
							<Input
								id="ban-duration"
								type="number"
								value={banDuration}
								onChange={(e) => setBanDuration(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setPending(null)}
							disabled={busy}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={confirmBan}
							disabled={busy || !banReason}
						>
							Ban
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={pending?.kind === "give-currency"}
				onOpenChange={(o) => !o && setPending(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Adjust currency for{" "}
							{pending?.kind === "give-currency" ? pending.ids.length : 0} users
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-3">
						<div>
							<Label>Type</Label>
							<Select
								value={currencyType}
								onValueChange={(v) => setCurrencyType(v as typeof currencyType)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="credits">
										<span className="inline-flex items-center gap-2">
											<CurrencyIcon kind="credits" size={14} /> Credits
										</span>
									</SelectItem>
									<SelectItem value="pixels">
										<span className="inline-flex items-center gap-2">
											<CurrencyIcon kind="pixels" size={14} /> Pixels (Duckets)
										</span>
									</SelectItem>
									<SelectItem value="points">
										<span className="inline-flex items-center gap-2">
											<CurrencyIcon kind="diamonds" size={14} /> Points
											(Diamonds)
										</span>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="give-amount">
								Amount (positive = give, negative = take)
							</Label>
							<Input
								id="give-amount"
								type="number"
								value={currencyAmount}
								onChange={(e) => setCurrencyAmount(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setPending(null)}
							disabled={busy}
						>
							Cancel
						</Button>
						<Button
							onClick={confirmGiveCurrency}
							disabled={busy || !currencyAmount || Number(currencyAmount) === 0}
						>
							Apply
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={pending?.kind === "give-badge"}
				onOpenChange={(o) => !o && setPending(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Give badge to{" "}
							{pending?.kind === "give-badge" ? pending.ids.length : 0} users
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-3">
						<div>
							<Label htmlFor="badge-code">Badge code</Label>
							<Input
								id="badge-code"
								value={badgeCode}
								onChange={(e) => setBadgeCode(e.target.value)}
								placeholder="ACH_*, etc."
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setPending(null)}
							disabled={busy}
						>
							Cancel
						</Button>
						<Button
							onClick={confirmGiveBadge}
							disabled={busy || !badgeCode.trim()}
						>
							Give
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
