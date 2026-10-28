"use client";

import {
	Check,
	CloudDownload,
	Download,
	Loader2,
	Package,
	Pencil,
	Plus,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { ImportErrorBanner } from "@/components/admin/import-error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { refreshCatalogTree } from "@/features/catalog/client/use-live-catalog";
import { adminFetch } from "@/lib/admin-fetch";
import { HABBO_GAMEDATA_HOTELS } from "@/lib/habbo-gamedata-hotel";
import { runSseImport } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CloneSource {
	id: string;
	name: string;
	furnidataUrl: string;
	nitroBaseUrl: string;
	iconBaseUrl: string;
	hotel: string;
	enabled?: boolean;
}

interface FurniItem {
	classname: string;
	name: string;
	description?: string;
	revision?: number;
	category?: string;
	itemType: "s" | "i";
	xdim: number;
	ydim: number;
	present: boolean;
}

interface CloneStats {
	total: number;
	present: number;
	clonable: number;
}

interface PageMeta {
	page: number;
	perPage: number;
	total: number;
}

// ── Source form ───────────────────────────────────────────────────────────────

interface SourceFormProps {
	initial?: Partial<CloneSource>;
	onSave: (src: Partial<CloneSource>) => Promise<void>;
	onCancel: () => void;
	saving: boolean;
}

function SourceForm({ initial, onSave, onCancel, saving }: SourceFormProps) {
	const [name, setName] = useState(initial?.name ?? "");
	const [furnidataUrl, setFurnidataUrl] = useState(initial?.furnidataUrl ?? "");
	const [nitroBaseUrl, setNitroBaseUrl] = useState(initial?.nitroBaseUrl ?? "");
	const [iconBaseUrl, setIconBaseUrl] = useState(initial?.iconBaseUrl ?? "");
	const [hotel, setHotel] = useState(initial?.hotel ?? "");
	const [enabled, setEnabled] = useState(initial?.enabled ?? true);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		await onSave({
			id: initial?.id,
			name,
			furnidataUrl,
			nitroBaseUrl,
			iconBaseUrl,
			hotel,
			enabled,
		});
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="space-y-3 rounded-lg border p-4 bg-card"
		>
			<div className="text-sm font-medium">
				{initial?.id ? "Edit Source" : "Add Source"}
			</div>
			<div className="grid gap-2">
				<Input
					placeholder="Name (e.g. HotelX)"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
				/>
				<Input
					placeholder="FurnitureData URL (e.g. https://x/FurnitureData.json)"
					value={furnidataUrl}
					onChange={(e) => setFurnidataUrl(e.target.value)}
					required
				/>
				<Input
					placeholder="Nitro base URL (e.g. https://x/bundled/furniture)"
					value={nitroBaseUrl}
					onChange={(e) => setNitroBaseUrl(e.target.value)}
					required
				/>
				<Input
					placeholder="Icon base URL (e.g. https://x/icons)"
					value={iconBaseUrl}
					onChange={(e) => setIconBaseUrl(e.target.value)}
					required
				/>
				<Select value={hotel} onValueChange={setHotel}>
					<SelectTrigger>
						<SelectValue placeholder="Hotel (optional)" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">None</SelectItem>
						{HABBO_GAMEDATA_HOTELS.map((h) => (
							<SelectItem key={h.value} value={h.value}>
								{h.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(e) => setEnabled(e.target.checked)}
						className="h-4 w-4 rounded border-input"
					/>
					Enabled (retired sources are excluded from counts and imports)
				</label>
			</div>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={saving}>
					{saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
					Save
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onCancel}
					disabled={saving}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}

// ── Sources manager ───────────────────────────────────────────────────────────

interface SourcesManagerProps {
	sources: CloneSource[];
	activeSourceId: string | null;
	onSelect: (src: CloneSource) => void;
	onRefresh: () => Promise<void>;
}

function SourcesManager({
	sources,
	activeSourceId,
	onSelect,
	onRefresh,
}: SourcesManagerProps) {
	const [showForm, setShowForm] = useState(false);
	const [editSrc, setEditSrc] = useState<CloneSource | null>(null);
	const [saving, setSaving] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	async function handleSave(src: Partial<CloneSource>) {
		setSaving(true);
		try {
			const res = await adminFetch("/cms_api/admin/import/clone", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(src),
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || "Save failed");
				return;
			}
			toast.success(src.id ? "Source updated" : "Source added");
			setShowForm(false);
			setEditSrc(null);
			await onRefresh();
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete(src: CloneSource) {
		setDeletingId(src.id);
		try {
			const res = await adminFetch(
				`/cms_api/admin/import/clone?id=${encodeURIComponent(src.id)}`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || "Delete failed");
				return;
			}
			toast.success(`${src.name} removed`);
			await onRefresh();
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium text-muted-foreground">
					Clone Sources
				</span>
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs"
					onClick={() => {
						setEditSrc(null);
						setShowForm(true);
					}}
				>
					<Plus className="w-3 h-3 mr-1" />
					Add Source
				</Button>
			</div>

			{showForm && !editSrc && (
				<SourceForm
					onSave={handleSave}
					onCancel={() => setShowForm(false)}
					saving={saving}
				/>
			)}

			{sources.length === 0 && !showForm && (
				<div className="text-center py-6 text-muted-foreground text-sm">
					<CloudDownload className="w-8 h-8 mx-auto mb-2 opacity-40" />
					No sources yet. Add one to start cloning furni from another hotel.
				</div>
			)}

			{sources.map((src) => (
				<div key={src.id}>
					{editSrc?.id === src.id ? (
						<SourceForm
							initial={src}
							onSave={handleSave}
							onCancel={() => setEditSrc(null)}
							saving={saving}
						/>
					) : (
						<div
							className={cn(
								"w-full rounded-lg border px-3 py-2.5 flex items-center gap-2 transition-colors hover:border-border",
								activeSourceId === src.id &&
									"border-primary ring-1 ring-primary bg-primary/5",
							)}
						>
							<button
								type="button"
								className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
								onClick={() => onSelect(src)}
							>
								<CloudDownload className="w-4 h-4 text-muted-foreground shrink-0" />
								<div className="flex-1 min-w-0">
									<div className="text-sm font-medium truncate">{src.name}</div>
									<div className="text-xs text-muted-foreground truncate">
										{src.furnidataUrl}
									</div>
									{src.hotel ? (
										<div className="text-[10px] text-muted-foreground/70">
											{HABBO_GAMEDATA_HOTELS.find((h) => h.value === src.hotel)
												?.label ?? `habbo.${src.hotel}`}
										</div>
									) : null}
								</div>
							</button>
							<div className="flex items-center gap-1 shrink-0">
								<Button
									variant="ghost"
									size="sm"
									className="h-6 w-6 p-0"
									title="Edit source"
									onClick={() => {
										setEditSrc(src);
										setShowForm(false);
									}}
								>
									<Pencil className="w-3 h-3" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 w-6 p-0 text-destructive hover:text-destructive"
									title="Delete source"
									disabled={deletingId === src.id}
									onClick={() => handleDelete(src)}
								>
									{deletingId === src.id ? (
										<Loader2 className="w-3 h-3 animate-spin" />
									) : (
										<Trash2 className="w-3 h-3" />
									)}
								</Button>
							</div>
						</div>
					)}
				</div>
			))}
		</div>
	);
}

// ── Furni icon with fallback ──────────────────────────────────────────────────

function FurniIcon({
	sourceId,
	iconBaseUrl,
	classname,
}: {
	sourceId: string;
	iconBaseUrl: string;
	classname: string;
}) {
	// 0 = source's standalone icon, 1 = icon extracted from the .nitro (our
	// endpoint), 2 = give up and show a placeholder.
	const [stage, setStage] = useState(0);
	if (stage >= 2) {
		return <Package className="w-8 h-8 text-muted-foreground/50" />;
	}
	const src =
		stage === 0
			? `${iconBaseUrl}/${classname}_icon.png`
			: `/cms_api/admin/import/clone/icon?source=${encodeURIComponent(sourceId)}&classname=${encodeURIComponent(classname)}`;
	return (
		<img
			key={stage}
			src={src}
			alt={classname}
			className="max-h-full max-w-full object-contain image-pixelated"
			onError={() => setStage((s) => s + 1)}
		/>
	);
}

// ── Furni grid view ───────────────────────────────────────────────────────────

interface FurniGridProps {
	source: CloneSource;
}

const PER_PAGE = 50;

function FurniGrid({ source }: FurniGridProps) {
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [searchTerm, setSearchTerm] = useState("");
	const [activeSearch, setActiveSearch] = useState("");
	const [items, setItems] = useState<FurniItem[]>([]);
	const [stats, setStats] = useState<CloneStats | null>(null);
	const [meta, setMeta] = useState<PageMeta | null>(null);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [batchProgress, setBatchProgress] = useState<{
		done: number;
		total: number;
	} | null>(null);
	const [busyClassname, setBusyClassname] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | "missing" | "present">("all");
	const batchAbortRef = useRef<AbortController | null>(null);
	// Classnames the server already has, mirroring `items`. Lets markDone flip a
	// card and adjust the counters without a refetch, and idempotently — React
	// may run a state updater twice in dev.
	const presentRef = useRef<Set<string>>(new Set());

	const fetchItems = useCallback(
		async (
			search: string,
			pageNum: number,
			filterVal: "all" | "missing" | "present" = "all",
		) => {
			setLoading(true);
			setError("");
			try {
				const params = new URLSearchParams({
					source: source.id,
					page: String(pageNum),
					perPage: String(PER_PAGE),
				});
				if (search) params.set("search", search);
				if (filterVal !== "all") params.set("filter", filterVal);
				const res = await adminFetch(`/cms_api/admin/import/clone?${params}`);
				const data = await res.json();
				if (!res.ok) {
					setError(data.error || "Failed to load");
					return;
				}
				setItems(data.items || []);
				setMeta(data.meta || null);
				setStats(data.stats || null);
				presentRef.current = new Set(
					(data.items || [])
						.filter((it: FurniItem) => it.present)
						.map((it: FurniItem) => it.classname),
				);
				setSelected(new Set());
			} catch {
				setError("Network error");
			} finally {
				setLoading(false);
			}
		},
		[source.id],
	);

	useEffect(() => {
		setPage(1);
		setSearchTerm("");
		setActiveSearch("");
		setItems([]);
		setStats(null);
		setMeta(null);
		setFilter("all");
		fetchItems("", 1, "all");
	}, [fetchItems]);

	function doSearch() {
		setActiveSearch(searchTerm);
		setPage(1);
		fetchItems(searchTerm, 1, filter);
	}

	function goPage(dir: "prev" | "next") {
		const next = dir === "next" ? page + 1 : Math.max(1, page - 1);
		setPage(next);
		fetchItems(activeSearch, next, filter);
	}

	function changeFilter(f: "all" | "missing" | "present") {
		setFilter(f);
		setPage(1);
		fetchItems(activeSearch, 1, f);
	}

	const importable = items.filter((it) => !it.present);
	const total = meta?.total ?? 0;
	const lastPage = Math.max(Math.ceil(total / PER_PAGE), 1);

	function toggle(classname: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(classname)) n.delete(classname);
			else n.add(classname);
			return n;
		});
	}

	function markDone(classname: string) {
		// Counters move as each clone lands, so total/present/clonable stay
		// truthful for the whole run instead of jumping at the end.
		if (presentRef.current.has(classname)) return;
		presentRef.current.add(classname);
		setStats((prev) =>
			prev
				? {
						...prev,
						present: prev.present + 1,
						clonable: Math.max(0, prev.clonable - 1),
					}
				: prev,
		);
		setItems((prev) =>
			prev.map((it) =>
				it.classname === classname ? { ...it, present: true } : it,
			),
		);
	}

	async function cloneViaSse(toClone: FurniItem[]) {
		batchAbortRef.current?.abort();
		const abort = new AbortController();
		batchAbortRef.current = abort;
		setBatchProgress({ done: 0, total: toClone.length });
		let done = 0;
		try {
			await runSseImport(
				"/cms_api/admin/import/clone/batch",
				{
					sourceId: source.id,
					classnames: toClone.map((it) => it.classname),
					concurrency: 10,
				},
				(classname) => {
					done++;
					markDone(classname);
					setBatchProgress({ done, total: toClone.length });
				},
				(succeeded, failed) => {
					setSelected(new Set());
					if (succeeded > 0) toast.success(`${succeeded} furni cloned`);
					if (failed > 0) toast.error(`${failed} failed`);
					fetchItems(activeSearch, page, filter);
					// Cloning writes catalog rows and category pages server-side.
					if (succeeded > 0) void refreshCatalogTree();
				},
				abort.signal,
				() => {
					done++;
					setBatchProgress({ done, total: toClone.length });
				},
			);
		} catch (err) {
			if ((err as Error)?.name === "AbortError") {
				toast.info("Clone cancelled");
			} else {
				throw err;
			}
		} finally {
			if (batchAbortRef.current === abort) batchAbortRef.current = null;
			setBatchProgress(null);
		}
	}

	async function cloneOne(it: FurniItem) {
		setBusyClassname(it.classname);
		try {
			await cloneViaSse([it]);
		} finally {
			setBusyClassname(null);
		}
	}

	async function cloneSelected() {
		const toClone = items.filter(
			(it) => selected.has(it.classname) && !it.present,
		);
		if (toClone.length === 0) return;
		await cloneViaSse(toClone);
	}

	// Clone EVERY not-yet-present furni from the source (across all pages),
	// in chunks of 400 to stay under the batch endpoint's 500 cap.
	async function cloneAll() {
		let names: string[] = [];
		try {
			const res = await adminFetch(
				`/cms_api/admin/import/clone?source=${encodeURIComponent(source.id)}&action=clonable`,
			);
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || "Failed to load clonable list");
				return;
			}
			names = data.classnames || [];
		} catch {
			toast.error("Network error");
			return;
		}
		if (names.length === 0) {
			toast.info("Nothing to clone — everything is already present");
			return;
		}
		const confirmed = await confirm({
			title: "Clone All Furni",
			description: `Clone ALL ${names.length} furni from "${source.name}"? This can take a while.`,
			confirmLabel: "Clone All",
		});
		if (!confirmed) return;
		batchAbortRef.current?.abort();
		const abort = new AbortController();
		batchAbortRef.current = abort;
		const CHUNK = 400;
		setBatchProgress({ done: 0, total: names.length });
		let done = 0;
		let okCount = 0;
		let failCount = 0;
		try {
			for (let i = 0; i < names.length; i += CHUNK) {
				if (abort.signal.aborted) break;
				const chunk = names.slice(i, i + CHUNK);
				await runSseImport(
					"/cms_api/admin/import/clone/batch",
					{ sourceId: source.id, classnames: chunk, concurrency: 10 },
					(classname) => {
						done++;
						markDone(classname);
						setBatchProgress({ done, total: names.length });
					},
					(succeeded, failed) => {
						okCount += succeeded;
						failCount += failed;
					},
					abort.signal,
					() => {
						done++;
						setBatchProgress({ done, total: names.length });
					},
				);
			}
			if (abort.signal.aborted) {
				toast.info("Clone cancelled");
			} else {
				if (okCount > 0) toast.success(`${okCount} furni cloned`);
				if (failCount > 0) toast.error(`${failCount} failed`);
			}
			setSelected(new Set());
			fetchItems(activeSearch, page, filter);
			if (okCount > 0) void refreshCatalogTree();
		} catch (err) {
			if ((err as Error)?.name === "AbortError") {
				toast.info("Clone cancelled");
			} else {
				throw err;
			}
		} finally {
			if (batchAbortRef.current === abort) batchAbortRef.current = null;
			setBatchProgress(null);
		}
	}

	return (
		<div className="space-y-4">
			{confirmDialog}
			{/* Stats bar */}
			{stats && (
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{stats.total}</span>
						<span className="text-muted-foreground">total</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Check className="h-4 w-4 text-[var(--admin-success)]" />
						<span className="font-medium text-[var(--admin-success)]">
							{stats.present}
						</span>
						<span className="text-muted-foreground">present</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Download className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{stats.clonable}</span>
						<span className="text-muted-foreground">clonable</span>
					</div>
				</div>
			)}

			{/* Search bar */}
			<div className="flex gap-2 flex-wrap">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search by classname or name…"
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") doSearch();
							if (e.key === "Escape") {
								setSearchTerm("");
								setActiveSearch("");
								setPage(1);
								fetchItems("", 1, filter);
							}
						}}
						className="pl-9 pr-8"
					/>
					{searchTerm && (
						<button
							type="button"
							onClick={() => {
								setSearchTerm("");
								setActiveSearch("");
								setPage(1);
								fetchItems("", 1, filter);
							}}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<Button onClick={doSearch} size="sm" disabled={loading}>
					{loading ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Search className="w-4 h-4" />
					)}
				</Button>
			</div>

			{/* Filter: all / not-present / present */}
			<div className="flex items-center gap-1 flex-wrap">
				{(
					[
						{ key: "all", label: "All", count: stats?.total },
						{
							key: "missing",
							label: "Not present (don't have)",
							count: stats?.clonable,
						},
						{ key: "present", label: "Present", count: stats?.present },
					] as const
				).map((f) => (
					<Button
						key={f.key}
						type="button"
						size="sm"
						variant={filter === f.key ? "default" : "outline"}
						className="h-7 text-xs"
						disabled={loading || !!batchProgress}
						onClick={() => changeFilter(f.key)}
					>
						{f.label}
						{typeof f.count === "number" ? ` (${f.count})` : ""}
					</Button>
				))}
			</div>

			{/* Bulk actions */}
			{(importable.length > 0 || (stats?.clonable ?? 0) > 0) && (
				<div className="flex items-center gap-2 flex-wrap">
					{importable.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="text-xs h-8"
							disabled={!!batchProgress}
							onClick={() =>
								setSelected((prev) =>
									prev.size === importable.length
										? new Set()
										: new Set(importable.map((it) => it.classname)),
								)
							}
						>
							{selected.size === importable.length
								? "Deselect page"
								: `Select page (${importable.length})`}
						</Button>
					)}
					{selected.size > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="h-8"
							onClick={cloneSelected}
							disabled={!!batchProgress}
						>
							{batchProgress ? (
								<Loader2 className="w-4 h-4 animate-spin mr-1" />
							) : (
								<CloudDownload className="w-4 h-4 mr-1" />
							)}
							Clone {selected.size} selected
						</Button>
					)}
					{(stats?.clonable ?? 0) > 0 && (
						<Button
							size="sm"
							className="h-8"
							onClick={cloneAll}
							disabled={!!batchProgress}
						>
							{batchProgress ? (
								<Loader2 className="w-4 h-4 animate-spin mr-1" />
							) : (
								<CloudDownload className="w-4 h-4 mr-1" />
							)}
							Clone all clonable ({stats?.clonable})
						</Button>
					)}
					{batchProgress && (
						<>
							<span className="text-xs text-muted-foreground">
								{batchProgress.done}/{batchProgress.total}
							</span>
							<Button
								size="sm"
								variant="outline"
								className="h-8"
								onClick={() => batchAbortRef.current?.abort()}
							>
								Cancel
							</Button>
						</>
					)}
				</div>
			)}

			{/* Error */}
			{error && <ImportErrorBanner error={error} />}

			{/* Empty state */}
			{!loading && items.length === 0 && !error && (
				<div className="text-center py-12 text-muted-foreground">
					<CloudDownload className="w-12 h-12 mx-auto mb-3 opacity-50" />
					<p className="text-sm">
						No furni found{activeSearch ? ` for "${activeSearch}"` : ""}
					</p>
				</div>
			)}

			{/* Grid */}
			{items.length > 0 && (
				<div
					className={cn(
						"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
						loading && "opacity-50",
					)}
				>
					{items.map((it) => {
						const isSelected = selected.has(it.classname);
						return (
							<div
								key={it.classname}
								className={cn(
									"group rounded-lg border overflow-hidden bg-card relative hover:border-border transition-all",
									it.present && "ring-1 ring-[var(--admin-success)]/30",
									isSelected && "ring-2 ring-primary border-primary",
								)}
							>
								{!it.present && (
									<button
										type="button"
										onClick={() => toggle(it.classname)}
										className={cn(
											"absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
											isSelected
												? "bg-primary border-primary text-primary-foreground"
												: "bg-background/80 border-muted-foreground/30 hover:border-muted-foreground",
										)}
									>
										{isSelected && <Check className="w-3 h-3" />}
									</button>
								)}
								{/* Type badge */}
								<div className="absolute top-1.5 right-1.5 z-10">
									<Badge
										variant="outline"
										className="text-[9px] px-1 py-0 bg-background/80"
									>
										{it.itemType === "s" ? "floor" : "wall"}
									</Badge>
								</div>

								<div className="relative flex items-center justify-center h-28 bg-accent/20">
									<FurniIcon
										sourceId={source.id}
										iconBaseUrl={source.iconBaseUrl}
										classname={it.classname}
									/>
									{/* Hover detail tooltip */}
									<div className="absolute bottom-1 left-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
										<div className="bg-[var(--admin-overlay)] backdrop-blur-sm rounded px-2 py-1.5 text-[10px] text-[var(--admin-sidebar-text)] space-y-0.5">
											{it.description ? (
												<p className="truncate">{it.description}</p>
											) : null}
											<div className="flex gap-2 text-[var(--admin-sidebar-text)]/70">
												{it.revision ? <span>Rev: {it.revision}</span> : null}
												<span>{it.itemType === "s" ? "Floor" : "Wall"}</span>
												<span>
													{it.xdim}×{it.ydim}
												</span>
											</div>
										</div>
									</div>
								</div>

								<div className="px-2.5 py-2 border-t space-y-1">
									<div className="text-xs font-bold truncate" title={it.name}>
										{it.name || it.classname}
									</div>
									<div
										className="text-[10px] text-muted-foreground truncate"
										title={it.classname}
									>
										{it.classname}
									</div>
									<div className="text-[10px] text-muted-foreground truncate">
										{it.itemType === "s" ? "Floor" : "Wall"} ·{" "}
										{it.category || "other"}
									</div>
									<div className="pt-1">
										{it.present ? (
											<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 w-full justify-center">
												<Check className="w-2.5 h-2.5" />
												Present
											</Badge>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="w-full text-xs h-7"
												disabled={
													busyClassname === it.classname || !!batchProgress
												}
												onClick={() => cloneOne(it)}
											>
												{busyClassname === it.classname ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<CloudDownload className="w-3 h-3 mr-1" />
												)}
												Clone
											</Button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Pagination */}
			{total > PER_PAGE && (
				<div className="flex items-center justify-between flex-wrap gap-2">
					<span className="text-sm text-muted-foreground">
						Page {page} / {lastPage}
					</span>
					<div className="flex gap-1">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1 || loading}
							onClick={() => goPage("prev")}
						>
							&larr; Prev
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= lastPage || loading}
							onClick={() => goPage("next")}
						>
							Next &rarr;
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Root component ────────────────────────────────────────────────────────────

export function ImportCloneClient() {
	const [sources, setSources] = useState<CloneSource[]>([]);
	const [activeSource, setActiveSource] = useState<CloneSource | null>(null);
	const [loadingSources, setLoadingSources] = useState(true);

	const fetchSources = useCallback(async () => {
		try {
			const res = await adminFetch("/cms_api/admin/import/clone?action=sources");
			const data = await res.json();
			if (res.ok) {
				setSources(data.sources || []);
			}
		} catch {
			/* ignore */
		} finally {
			setLoadingSources(false);
		}
	}, []);

	useEffect(() => {
		fetchSources();
	}, [fetchSources]);

	return (
		<div className="space-y-6">
			{/* Sources panel */}
			<div className="rounded-xl border bg-card p-4 space-y-4">
				{loadingSources ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="w-4 h-4 animate-spin" />
						Loading sources…
					</div>
				) : (
					<SourcesManager
						sources={sources}
						activeSourceId={activeSource?.id ?? null}
						onSelect={setActiveSource}
						onRefresh={fetchSources}
					/>
				)}
			</div>

			{/* Furni grid panel */}
			{activeSource ? (
				<div className="rounded-xl border bg-card p-4">
					<div className="flex items-center gap-2 mb-4">
						<CloudDownload className="w-4 h-4 text-muted-foreground" />
						<span className="text-sm font-medium">{activeSource.name}</span>
					</div>
					<FurniGrid source={activeSource} />
				</div>
			) : (
				<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
					Select a source above to browse and clone furni.
				</div>
			)}
		</div>
	);
}
