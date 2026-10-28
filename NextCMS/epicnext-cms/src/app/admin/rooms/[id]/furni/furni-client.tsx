"use client";

import {
	Armchair,
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Frame,
	Layers,
	Pencil,
	RefreshCw,
	Search,
	Trash2,
	Users,
	UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	bulkDeleteRoomItems,
	deleteRoomItem,
	roomRconAction,
} from "@/actions/rooms";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useServerAction } from "@/hooks/use-server-action";
import { EditItemDialog } from "./edit-item-dialog";

interface FurniRow {
	id: number;
	baseId: number;
	name: string;
	itemName: string;
	type: string;
	x: number;
	y: number;
	z: number;
	rot: number;
	wallPos: string;
	userId: number;
	ownerUsername: string | null;
	extraData: string;
}

interface Props {
	room: {
		id: number;
		name: string;
		ownerUsername: string;
	};
	items?: FurniRow[];
	canEdit: boolean;
}

const PER_PAGE = 50;
type SortKey = "id" | "name" | "type" | "pos" | "owner";
type SortDir = "asc" | "desc";
type View = "flat" | "grouped";

function iconUrl(itemName: string) {
	if (!itemName) return null;
	const base = itemName.split("*")[0];
	return `/swf/dcr/hof_furni/icons/${base}_icon.png`;
}

function isWallType(t: string) {
	return t === "i";
}

export function FurniClient({ room, items = [], canEdit }: Props) {
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [view, setView] = useState<View>("flat");
	const [typeFilter, setTypeFilter] = useState<"all" | "floor" | "wall">("all");
	const [ownerFilter, setOwnerFilter] = useState<string>("all");
	const [sortKey, setSortKey] = useState<SortKey>("id");
	const [sortDir, setSortDir] = useState<SortDir>("desc");
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [editingItem, setEditingItem] = useState<FurniRow | null>(null);

	// ── Stats ──────────────────────────────────────────────────
	const stats = useMemo(() => {
		const floor = items.filter((i) => !isWallType(i.type)).length;
		const wall = items.filter((i) => isWallType(i.type)).length;
		const uniqueBases = new Set(items.map((i) => i.baseId)).size;
		const owners = new Set(items.map((i) => i.userId).filter((u) => u > 0))
			.size;
		return { total: items.length, floor, wall, uniqueBases, owners };
	}, [items]);

	// ── Owner options for filter ───────────────────────────────
	const ownerOptions = useMemo(() => {
		const map = new Map<string, number>();
		for (const i of items) {
			const key = i.ownerUsername ?? `#${i.userId}`;
			map.set(key, (map.get(key) ?? 0) + 1);
		}
		return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
	}, [items]);

	// ── Filtering ──────────────────────────────────────────────
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return items.filter((i) => {
			if (typeFilter === "floor" && isWallType(i.type)) return false;
			if (typeFilter === "wall" && !isWallType(i.type)) return false;
			if (ownerFilter !== "all") {
				const key = i.ownerUsername ?? `#${i.userId}`;
				if (key !== ownerFilter) return false;
			}
			if (q) {
				return (
					i.name.toLowerCase().includes(q) ||
					i.itemName.toLowerCase().includes(q) ||
					String(i.baseId).includes(q) ||
					String(i.id).includes(q)
				);
			}
			return true;
		});
	}, [items, search, typeFilter, ownerFilter]);

	// ── Sorting ────────────────────────────────────────────────
	const sorted = useMemo(() => {
		const arr = [...filtered];
		arr.sort((a, b) => {
			let cmp = 0;
			switch (sortKey) {
				case "id":
					cmp = a.id - b.id;
					break;
				case "name":
					cmp = a.name.localeCompare(b.name);
					break;
				case "type":
					cmp = a.type.localeCompare(b.type);
					break;
				case "pos":
					cmp = a.x - b.x || a.y - b.y;
					break;
				case "owner":
					cmp = (a.ownerUsername ?? "").localeCompare(b.ownerUsername ?? "");
					break;
			}
			return sortDir === "asc" ? cmp : -cmp;
		});
		return arr;
	}, [filtered, sortKey, sortDir]);

	// ── Grouped view ───────────────────────────────────────────
	const grouped = useMemo(() => {
		const map = new Map<
			number,
			{ base: FurniRow; count: number; ids: number[] }
		>();
		for (const i of filtered) {
			const existing = map.get(i.baseId);
			if (existing) {
				existing.count++;
				existing.ids.push(i.id);
			} else {
				map.set(i.baseId, { base: i, count: 1, ids: [i.id] });
			}
		}
		return Array.from(map.values()).sort((a, b) => b.count - a.count);
	}, [filtered]);

	// ── Pagination (flat view only) ─────────────────────────────
	const lastPage = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
	const currentPage = Math.min(page, lastPage);
	const pageRows = sorted.slice(
		(currentPage - 1) * PER_PAGE,
		currentPage * PER_PAGE,
	);

	// ── Handlers ───────────────────────────────────────────────
	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir("asc");
		}
	}

	function SortIcon({ k }: { k: SortKey }) {
		if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
		return sortDir === "asc" ? (
			<ArrowUp className="w-3 h-3" />
		) : (
			<ArrowDown className="w-3 h-3" />
		);
	}

	function togglePageSelection(checked: boolean) {
		const next = new Set(selected);
		for (const r of pageRows) {
			if (checked) next.add(r.id);
			else next.delete(r.id);
		}
		setSelected(next);
	}

	function toggleRowSelection(id: number, checked: boolean) {
		const next = new Set(selected);
		if (checked) next.add(id);
		else next.delete(id);
		setSelected(next);
	}

	async function handleRcon(action: "reload" | "kick") {
		if (action === "kick") {
			const ok = await confirm({
				title: "Kick Users",
				description: "Kick all users from this room?",
				confirmLabel: "Kick",
				variant: "danger",
			});
			if (!ok) return;
		}
		run(() => roomRconAction({ roomId: room.id, action }), {
			successMessage:
				action === "reload" ? "Room reloaded" : "All users kicked",
		});
	}

	async function handleDelete(itemId: number, name: string) {
		const ok = await confirm({
			title: "Delete Item",
			description: `Delete "${name}" (#${itemId}) from this room?`,
			confirmLabel: "Delete",
			variant: "danger",
		});
		if (!ok) return;
		run(() => deleteRoomItem({ roomId: room.id, itemId }), {
			successMessage: "Item deleted",
		});
	}

	async function handleBulkDelete() {
		if (selected.size === 0) return;
		const ok = await confirm({
			title: "Delete Items",
			description: `Delete ${selected.size} selected item${selected.size > 1 ? "s" : ""}?`,
			confirmLabel: "Delete",
			variant: "danger",
		});
		if (!ok) return;
		run(
			() =>
				bulkDeleteRoomItems({ roomId: room.id, itemIds: Array.from(selected) }),
			{
				successMessage: `${selected.size} item(s) deleted`,
				onSuccess: () => setSelected(new Set()),
			},
		);
	}

	async function handleDeleteGroup(
		_baseId: number,
		ids: number[],
		name: string,
	) {
		const ok = await confirm({
			title: "Delete Items",
			description: `Delete all ${ids.length} "${name}" from this room?`,
			confirmLabel: "Delete",
			variant: "danger",
		});
		if (!ok) return;
		run(() => bulkDeleteRoomItems({ roomId: room.id, itemIds: ids }), {
			successMessage: `${ids.length} item(s) deleted`,
		});
	}

	const allPageSelected =
		pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

	return (
		<div className="space-y-6">
			{confirmDialog}
			{/* ── Header ─────────────────────────────────────────── */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-4">
					<Link href={`/admin/rooms/show/${room.id}`}>
						<Button variant="outline" size="sm">
							<ArrowLeft className="w-4 h-4 mr-1" /> Back
						</Button>
					</Link>
					<div>
						<h1 className="text-2xl font-bold flex items-center gap-2">
							<Armchair className="w-6 h-6" />
							{room.name}
						</h1>
						<p className="text-sm text-muted-foreground">
							Room #{room.id} · Owner: {room.ownerUsername}
						</p>
					</div>
				</div>
				{canEdit && (
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleRcon("reload")}
							disabled={isPending}
						>
							<RefreshCw className="w-4 h-4 mr-1" /> Reload
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={() => handleRcon("kick")}
							disabled={isPending}
						>
							<UserX className="w-4 h-4 mr-1" /> Kick All
						</Button>
					</div>
				)}
			</div>

			{/* ── Stats Cards ────────────────────────────────────── */}
			<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
				<StatCard
					icon={<Armchair className="w-4 h-4" />}
					label="Total"
					value={stats.total}
				/>
				<StatCard
					icon={<Layers className="w-4 h-4" />}
					label="Floor"
					value={stats.floor}
				/>
				<StatCard
					icon={<Frame className="w-4 h-4" />}
					label="Wall"
					value={stats.wall}
				/>
				<StatCard
					icon={<Armchair className="w-4 h-4" />}
					label="Unique furni"
					value={stats.uniqueBases}
				/>
				<StatCard
					icon={<Users className="w-4 h-4" />}
					label="Owners"
					value={stats.owners}
				/>
			</div>

			{/* ── Toolbar ────────────────────────────────────────── */}
			<Card>
				<CardContent className="pt-6 space-y-4">
					<div className="flex flex-wrap items-center gap-3">
						<div className="relative flex-1 min-w-[200px] max-w-sm">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
							<Input
								placeholder="Search by name or ID..."
								value={search}
								onChange={(e) => {
									setSearch(e.target.value);
									setPage(1);
								}}
								className="pl-8"
							/>
						</div>

						<Select
							value={typeFilter}
							onValueChange={(v) => {
								setTypeFilter(v as "all" | "floor" | "wall");
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[140px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All types</SelectItem>
								<SelectItem value="floor">Floor only</SelectItem>
								<SelectItem value="wall">Wall only</SelectItem>
							</SelectContent>
						</Select>

						<Select
							value={ownerFilter}
							onValueChange={(v) => {
								setOwnerFilter(v);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[180px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All owners</SelectItem>
								{ownerOptions.map(([name, count]) => (
									<SelectItem key={name} value={name}>
										{name} ({count})
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<Tabs
							value={view}
							onValueChange={(v) => setView(v as View)}
							className="ml-auto"
						>
							<TabsList>
								<TabsTrigger value="flat">Flat</TabsTrigger>
								<TabsTrigger value="grouped">Grouped</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>

					{/* Bulk action bar */}
					{view === "flat" && selected.size > 0 && canEdit && (
						<div className="flex items-center justify-between bg-muted/50 border rounded-md px-3 py-2">
							<span className="text-sm">
								<strong>{selected.size}</strong> selected
							</span>
							<div className="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setSelected(new Set())}
								>
									Clear
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onClick={handleBulkDelete}
									disabled={isPending}
								>
									<Trash2 className="w-4 h-4 mr-1" /> Delete selected
								</Button>
							</div>
						</div>
					)}

					{/* ── Flat Table ─────────────────────────────────── */}
					{view === "flat" ? (
						<>
							<div className="border rounded-md overflow-hidden">
								<Table>
									<TableHeader>
										<TableRow>
											{canEdit && (
												<TableHead className="w-10">
													<Checkbox
														checked={allPageSelected}
														onCheckedChange={(c) =>
															togglePageSelection(c === true)
														}
													/>
												</TableHead>
											)}
											<TableHead className="w-16"></TableHead>
											<TableHead>
												<button
													type="button"
													className="flex items-center gap-1 hover:text-foreground"
													onClick={() => toggleSort("name")}
												>
													Name <SortIcon k="name" />
												</button>
											</TableHead>
											<TableHead className="w-20">
												<button
													type="button"
													className="flex items-center gap-1 hover:text-foreground"
													onClick={() => toggleSort("type")}
												>
													Type <SortIcon k="type" />
												</button>
											</TableHead>
											<TableHead className="w-32">
												<button
													type="button"
													className="flex items-center gap-1 hover:text-foreground"
													onClick={() => toggleSort("pos")}
												>
													Position <SortIcon k="pos" />
												</button>
											</TableHead>
											<TableHead className="w-16">Rot</TableHead>
											<TableHead className="w-32">
												<button
													type="button"
													className="flex items-center gap-1 hover:text-foreground"
													onClick={() => toggleSort("owner")}
												>
													Owner <SortIcon k="owner" />
												</button>
											</TableHead>
											<TableHead className="w-24">
												<button
													type="button"
													className="flex items-center gap-1 hover:text-foreground"
													onClick={() => toggleSort("id")}
												>
													ID <SortIcon k="id" />
												</button>
											</TableHead>
											{canEdit && (
												<TableHead className="w-24 text-right">
													Actions
												</TableHead>
											)}
										</TableRow>
									</TableHeader>
									<TableBody>
										{pageRows.length === 0 ? (
											<TableRow>
												<TableCell
													colSpan={canEdit ? 9 : 7}
													className="text-center text-muted-foreground py-12"
												>
													{items.length === 0 ? (
														<div className="space-y-2">
															<Armchair className="w-10 h-10 mx-auto opacity-30" />
															<p>This room has no furniture.</p>
														</div>
													) : (
														<p>No items match your filters.</p>
													)}
												</TableCell>
											</TableRow>
										) : (
											pageRows.map((item) => {
												const icon = iconUrl(item.itemName);
												const wall = isWallType(item.type);
												const isSelected = selected.has(item.id);
												return (
													<TableRow
														key={item.id}
														className={
															isSelected ? "bg-muted/40" : "hover:bg-muted/30"
														}
													>
														{canEdit && (
															<TableCell>
																<Checkbox
																	checked={isSelected}
																	onCheckedChange={(c) =>
																		toggleRowSelection(item.id, c === true)
																	}
																/>
															</TableCell>
														)}
														<TableCell>
															{icon ? (
																<img
																	src={icon}
																	alt={item.name}
																	className="w-10 h-10 object-contain"
																	onError={(e) => {
																		(
																			e.target as HTMLImageElement
																		).style.visibility = "hidden";
																	}}
																/>
															) : (
																<div className="w-10 h-10 bg-muted rounded" />
															)}
														</TableCell>
														<TableCell>
															<div className="font-medium">{item.name}</div>
															<div className="text-xs text-muted-foreground font-mono">
																{item.itemName || `base #${item.baseId}`}
															</div>
														</TableCell>
														<TableCell>
															<Badge variant={wall ? "outline" : "secondary"}>
																{wall
																	? "Wall"
																	: item.type === "s"
																		? "Floor"
																		: item.type}
															</Badge>
														</TableCell>
														<TableCell className="font-mono text-xs">
															{wall
																? item.wallPos || "-"
																: `${item.x},${item.y},${item.z.toFixed(1)}`}
														</TableCell>
														<TableCell className="font-mono text-xs">
															{item.rot}
														</TableCell>
														<TableCell className="text-sm">
															{item.ownerUsername ? (
																<Link
																	href={`/admin/users/show/${item.userId}`}
																	className="text-primary hover:underline"
																>
																	{item.ownerUsername}
																</Link>
															) : (
																<span className="text-muted-foreground">
																	#{item.userId}
																</span>
															)}
														</TableCell>
														<TableCell className="font-mono text-xs">
															#{item.id}
														</TableCell>
														{canEdit && (
															<TableCell className="text-right">
																<div className="flex justify-end gap-1">
																	<Button
																		variant="ghost"
																		size="sm"
																		onClick={() => setEditingItem(item)}
																		disabled={isPending}
																		title="Edit"
																	>
																		<Pencil className="w-4 h-4" />
																	</Button>
																	<Button
																		variant="ghost"
																		size="sm"
																		onClick={() =>
																			handleDelete(item.id, item.name)
																		}
																		disabled={isPending}
																		title="Delete"
																	>
																		<Trash2 className="w-4 h-4 text-destructive" />
																	</Button>
																</div>
															</TableCell>
														)}
													</TableRow>
												);
											})
										)}
									</TableBody>
								</Table>
							</div>

							{lastPage > 1 && (
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">
										Showing {(currentPage - 1) * PER_PAGE + 1}-
										{Math.min(currentPage * PER_PAGE, sorted.length)} of{" "}
										{sorted.length}
									</span>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(1, p - 1))}
											disabled={currentPage === 1}
										>
											<ChevronLeft className="w-4 h-4" />
										</Button>
										<span className="text-sm flex items-center px-2">
											{currentPage} / {lastPage}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
											disabled={currentPage === lastPage}
										>
											<ChevronRight className="w-4 h-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					) : (
						/* ── Grouped View ──────────────────────────────── */
						<div className="border rounded-md overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-16"></TableHead>
										<TableHead>Furniture</TableHead>
										<TableHead className="w-24">Type</TableHead>
										<TableHead className="w-24 text-right">Count</TableHead>
										{canEdit && (
											<TableHead className="w-32 text-right">Action</TableHead>
										)}
									</TableRow>
								</TableHeader>
								<TableBody>
									{grouped.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={canEdit ? 5 : 4}
												className="text-center text-muted-foreground py-12"
											>
												No items.
											</TableCell>
										</TableRow>
									) : (
										grouped.map((g) => {
											const icon = iconUrl(g.base.itemName);
											const wall = isWallType(g.base.type);
											return (
												<TableRow
													key={g.base.baseId}
													className="hover:bg-muted/30"
												>
													<TableCell>
														{icon ? (
															<img
																src={icon}
																alt={g.base.name}
																className="w-10 h-10 object-contain"
																onError={(e) => {
																	(
																		e.target as HTMLImageElement
																	).style.visibility = "hidden";
																}}
															/>
														) : (
															<div className="w-10 h-10 bg-muted rounded" />
														)}
													</TableCell>
													<TableCell>
														<div className="font-medium">{g.base.name}</div>
														<div className="text-xs text-muted-foreground font-mono">
															{g.base.itemName || `base #${g.base.baseId}`}
														</div>
													</TableCell>
													<TableCell>
														<Badge variant={wall ? "outline" : "secondary"}>
															{wall
																? "Wall"
																: g.base.type === "s"
																	? "Floor"
																	: g.base.type}
														</Badge>
													</TableCell>
													<TableCell className="text-right">
														<Badge>{g.count}</Badge>
													</TableCell>
													{canEdit && (
														<TableCell className="text-right">
															<Button
																variant="ghost"
																size="sm"
																onClick={() =>
																	handleDeleteGroup(
																		g.base.baseId,
																		g.ids,
																		g.base.name,
																	)
																}
																disabled={isPending}
															>
																<Trash2 className="w-4 h-4 text-destructive mr-1" />
																Delete all
															</Button>
														</TableCell>
													)}
												</TableRow>
											);
										})
									)}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<EditItemDialog
				roomId={room.id}
				item={editingItem}
				open={editingItem !== null}
				onOpenChange={(o) => !o && setEditingItem(null)}
			/>
		</div>
	);
}

function StatCard({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: number;
}) {
	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-xs text-muted-foreground">{label}</div>
						<div className="text-2xl font-bold">{value.toLocaleString()}</div>
					</div>
					<div className="text-muted-foreground">{icon}</div>
				</div>
			</CardContent>
		</Card>
	);
}
