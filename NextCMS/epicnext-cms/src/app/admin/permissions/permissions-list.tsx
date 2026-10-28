"use client";

import {
	Crown,
	EyeOff,
	Pencil,
	Plus,
	Shield,
	ShieldCheck,
	Trash2,
	UserCheck,
	Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createRank,
	deleteRank,
	repairAdminNavAclGrants,
} from "@/actions/permissions";
import Link from "@/components/link";
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
import { useServerAction } from "@/hooks/use-server-action";
import { formatNumber } from "@/lib/format-date";

interface RankSummary {
	id: number;
	rank_name: string;
	badge: string;
	level: number;
	prefix: string;
	prefix_color: string;
	hidden_rank: string;
	userCount: number;
}

interface Props {
	ranks: RankSummary[];
	fromHousekeeping?: boolean;
}

const RANK_ICONS: Record<number, React.ReactNode> = {
	7: <Crown className="h-4 w-4 text-[var(--admin-warning)]" />,
	6: <ShieldCheck className="h-4 w-4 text-[var(--admin-error)]" />,
	5: <Shield className="h-4 w-4 text-[var(--admin-info)]" />,
	4: <UserCheck className="h-4 w-4 text-[var(--admin-success)]" />,
};

const RANK_COLORS: Record<number, string> = {
	7: "border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]",
	6: "border-[var(--admin-error-border)] bg-[var(--admin-error-subtle)]",
	5: "border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)]",
	4: "border-[var(--admin-success-border)] bg-[var(--admin-success-subtle)]",
};

export function PermissionsList({
	ranks: initialRanks,
	fromHousekeeping = false,
}: Props) {
	const { run, isPending } = useServerAction();
	const [ranks, setRanks] = useState(initialRanks);
	const [deleteTarget, setDeleteTarget] = useState<RankSummary | null>(null);

	const [showCreate, setShowCreate] = useState(false);
	const [newRankName, setNewRankName] = useState("");
	const [newRankLevel, setNewRankLevel] = useState("");

	const totalUsers = ranks.reduce((sum, r) => sum + r.userCount, 0);

	function handleCreate() {
		const level = parseInt(newRankLevel, 10);
		if (!newRankName.trim() || !level || level < 1) {
			toast.error("Name and a valid level are required");
			return;
		}
		run(() => createRank({ rank_name: newRankName.trim(), level }), {
			successMessage: "Rank created",
			onSuccess: () => {
				setShowCreate(false);
				setNewRankName("");
				setNewRankLevel("");
			},
		});
	}

	function handleDelete() {
		if (!deleteTarget) return;
		run(() => deleteRank({ id: deleteTarget.id }), {
			successMessage: "Rank deleted",
			onSuccess: () => {
				setRanks((prev) => prev.filter((r) => r.id !== deleteTarget?.id));
				setDeleteTarget(null);
			},
		});
	}

	return (
		<div className="space-y-6">
			{fromHousekeeping ? (
				<div
					className="rounded-lg border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-4 py-3 text-sm"
					role="status"
				>
					You were sent here from the permission archive. Edit rank access below
					— this is the live control panel.
				</div>
			) : null}
			<div
				className="rounded-lg border border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)] px-4 py-3 text-sm text-[var(--admin-text)]"
				role="status"
			>
				<p className="m-0 font-semibold">Live access control</p>
				<p className="m-0 mt-1 text-muted-foreground">
					Changes here decide who can open admin and mod pages. The permission
					archive is only for compare/export.
				</p>
			</div>

			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground">
					{ranks.length} ranks &middot; {formatNumber(totalUsers)} users total
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						disabled={isPending}
						onClick={() =>
							run(() => repairAdminNavAclGrants(), {
								successMessage: "Admin nav ACL grants repaired",
							})
						}
						title="Fill missing admin.* grants for ranks that already have dashboard access (same as migration 0018)"
					>
						<ShieldCheck className="h-4 w-4 mr-1.5" />
						Repair nav grants
					</Button>
					<Button onClick={() => setShowCreate(true)}>
						<Plus className="h-4 w-4 mr-1.5" />
						New Rank
					</Button>
				</div>
			</div>

			{/* Rank cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{ranks.map((rank) => {
					const prefixColor = rank.prefix_color
						? rank.prefix_color.startsWith("#")
							? rank.prefix_color
							: `#${rank.prefix_color}`
						: undefined;
					return (
						<div
							key={rank.id}
							className={`rounded-xl border p-4 flex flex-col gap-3 hover:shadow-lg transition-all ${RANK_COLORS[rank.id] || ""}`}
						>
							{/* Header */}
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									{RANK_ICONS[rank.id] || (
										<Shield className="h-4 w-4 text-muted-foreground" />
									)}
									<span className="font-bold">
										{rank.rank_name || `Rank ${rank.id}`}
									</span>
								</div>
								<div className="flex items-center gap-1.5">
									{rank.hidden_rank === "1" && (
										<span title="Hidden rank">
											<EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
										</span>
									)}
									<Badge variant="secondary" className="font-mono text-[10px]">
										#{rank.id}
									</Badge>
								</div>
							</div>

							{/* Badges row */}
							<div className="flex flex-wrap gap-1.5">
								<Badge variant="outline" className="text-[11px]">
									Level {rank.level}
								</Badge>
								{rank.badge && (
									<Badge variant="outline" className="font-mono text-[11px]">
										{rank.badge}
									</Badge>
								)}
								{rank.prefix && (
									<Badge
										variant="outline"
										className="text-[11px]"
										style={{ color: prefixColor, borderColor: prefixColor }}
									>
										{rank.prefix}
									</Badge>
								)}
							</div>

							{/* User count */}
							<div className="flex items-center gap-1 text-xs text-muted-foreground">
								<Users className="h-3 w-3" />
								{formatNumber(rank.userCount)} users
							</div>

							{/* Actions */}
							<div className="flex gap-2 mt-auto pt-1">
								<Link href={`/admin/permissions/${rank.id}`} className="flex-1">
									<Button variant="outline" size="sm" className="w-full">
										<Pencil className="h-3.5 w-3.5 mr-1.5" />
										Configure
									</Button>
								</Link>
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
									disabled={rank.userCount > 0 || isPending}
									onClick={() => setDeleteTarget(rank)}
									title={
										rank.userCount > 0
											? `Cannot delete: ${rank.userCount} users`
											: "Delete rank"
									}
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					);
				})}
			</div>

			{/* Create rank dialog */}
			<Dialog open={showCreate} onOpenChange={setShowCreate}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create New Rank</DialogTitle>
						<DialogDescription>
							Add a new permission rank. You can configure its permissions after
							creation.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label>Rank Name</Label>
							<Input
								value={newRankName}
								onChange={(e) => setNewRankName(e.target.value)}
								placeholder="e.g. Moderator"
							/>
						</div>
						<div className="space-y-2">
							<Label>Level</Label>
							<Input
								type="number"
								value={newRankLevel}
								onChange={(e) => setNewRankLevel(e.target.value)}
								placeholder="e.g. 5"
								min={1}
							/>
							<p className="text-xs text-muted-foreground">
								Higher level = more base permissions in the emulator
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowCreate(false)}>
							Cancel
						</Button>
						<Button onClick={handleCreate} disabled={isPending}>
							{isPending ? "Creating..." : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete confirmation dialog */}
			<Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Rank #{deleteTarget?.id}?</DialogTitle>
						<DialogDescription>
							This will permanently delete &quot;{deleteTarget?.rank_name}&quot;
							and its CMS role. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={isPending}
						>
							{isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
