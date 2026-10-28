"use client";

import {
	Check,
	Download,
	Loader2,
	Package,
	Search,
	Shirt,
	Trash2,
	X,
} from "lucide-react";
// import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	BatchImportProgress,
	useBatchImport,
} from "@/components/admin/import/use-batch-import";
import { ImportErrorBanner } from "@/components/admin/import-error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-fetch";
import { getAvatarUrl } from "@/lib/imager";
import { cn } from "@/lib/utils";

// ── Shared types ─────────────────────────────────────────────────────────────

interface FigureItem {
	lib: string;
	revision: number;
	nitroExists: boolean;
	previewType?: string;
	previewId?: number;
}

interface ClothingSetItem {
	setType: string;
	setId: number;
	gender: string;
	club: number;
	sellable: boolean;
	present: boolean;
}

type Mode = "libs" | "sets";

const PER_PAGE = 100;

// ── Avatar preview (renders a mini avatar wearing the item) ───────────────────

// A default dressed avatar; the previewed part overrides/adds its slot so the
// item is shown on a complete figure.
const BASE_FIGURE: Record<string, string> = {
	hd: "hd-180-1",
	hr: "hr-828-45",
	ch: "ch-665-92",
	lg: "lg-700-82",
	sh: "sh-705-62",
};

// Head-worn slots → render head-only (zoomed) so the item fills the frame;
// everything else renders the full body.
const HEAD_TYPES = new Set(["hd", "hr", "ha", "he", "ea", "fa", "fc"]);

function buildPreviewFigure(type: string, id: number): string {
	const parts: Record<string, string> = { ...BASE_FIGURE };
	parts[type] = `${type}-${id}`; // default color
	return Object.values(parts).join(".");
}

function AvatarPreview({ type, id }: { type?: string; id?: number }) {
	const [failed, setFailed] = useState(false);
	if (failed || !type || id === undefined) {
		return <Shirt className="w-8 h-8 text-muted-foreground/60" />;
	}
	const figure = buildPreviewFigure(type, id);
	return (
		<img
			src={getAvatarUrl(figure, {
				direction: 2,
				headDirection: 3,
				headOnly: HEAD_TYPES.has(type),
			})}
			alt={`${type}-${id}`}
			className="max-h-full object-contain image-pixelated"
			onError={() => setFailed(true)}
		/>
	);
}

// ── Librerie (v1) view ────────────────────────────────────────────────────────

function LibsView() {
	const [searchTerm, setSearchTerm] = useState("");
	const [activeSearch, setActiveSearch] = useState("");
	const [items, setItems] = useState<FigureItem[]>([]);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busyLib, setBusyLib] = useState<string | null>(null);
	const batch = useBatchImport({
		url: "/cms_api/admin/import/clothing/batch",
		successAction: "libraries imported",
		cancelledMessage: "Import cancelled",
		onItemDone: (label) => markDone(label),
		onComplete: () => setSelected(new Set()),
	});

	const fetchItems = useCallback(async (search: string, pageNum: number) => {
		setLoading(true);
		setError("");
		try {
			const params = new URLSearchParams({ page: String(pageNum) });
			if (search) params.set("search", search);
			const res = await adminFetch(`/cms_api/admin/import/clothing?${params}`);
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Failed to load");
				return;
			}
			setItems(data.items || []);
			setTotal(data.meta?.total || 0);
			setSelected(new Set());
		} catch {
			setError("Network error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchItems("", 1);
	}, [fetchItems]);

	function doSearch() {
		setActiveSearch(searchTerm);
		setPage(1);
		fetchItems(searchTerm, 1);
	}

	function goPage(dir: "prev" | "next") {
		const next = dir === "next" ? page + 1 : Math.max(1, page - 1);
		setPage(next);
		fetchItems(activeSearch, next);
	}

	const importable = useMemo(
		() => items.filter((p) => !p.nitroExists),
		[items],
	);
	const importedCount = useMemo(
		() => items.filter((p) => p.nitroExists).length,
		[items],
	);
	const lastPage = Math.max(Math.ceil(total / PER_PAGE), 1);

	function toggle(lib: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(lib)) n.delete(lib);
			else n.add(lib);
			return n;
		});
	}

	function markDone(lib: string) {
		setItems((prev) =>
			prev.map((p) => (p.lib === lib ? { ...p, nitroExists: true } : p)),
		);
	}

	async function importViaSse(toImport: FigureItem[]) {
		await batch.run(
			toImport.map((p) => p.lib),
			{ items: toImport, concurrency: 3 },
		);
	}

	async function importOne(p: FigureItem) {
		setBusyLib(p.lib);
		try {
			await importViaSse([p]);
		} finally {
			setBusyLib(null);
		}
	}

	async function importSelected() {
		const toImport = items.filter((p) => selected.has(p.lib) && !p.nitroExists);
		if (toImport.length === 0) return;
		await importViaSse(toImport);
	}

	async function remove(p: FigureItem) {
		setBusyLib(p.lib);
		try {
			const res = await adminFetch(
				`/cms_api/admin/import/clothing?lib=${encodeURIComponent(p.lib)}`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (res.ok) {
				toast.success(`${p.lib} removed`);
				setItems((prev) =>
					prev.map((x) => (x.lib === p.lib ? { ...x, nitroExists: false } : x)),
				);
			} else {
				toast.error(data.error || "Delete failed");
			}
		} finally {
			setBusyLib(null);
		}
	}

	return (
		<div className="space-y-4">
			{(items.length > 0 || total > 0) && (
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{total}</span>
						<span className="text-muted-foreground">libraries</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Check className="h-4 w-4 text-[var(--admin-success)]" />
						<span className="font-medium text-[var(--admin-success)]">
							{importedCount}
						</span>
						<span className="text-muted-foreground">on this page</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Download className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{importable.length}</span>
						<span className="text-muted-foreground">missing here</span>
					</div>
				</div>
			)}

			<div className="flex gap-2 flex-wrap">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search libraries (e.g. Hair_F, shirt_M)..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") doSearch();
							if (e.key === "Escape") {
								setSearchTerm("");
								setActiveSearch("");
								setPage(1);
								fetchItems("", 1);
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
								fetchItems("", 1);
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

			{importable.length > 0 && (
				<div className="flex items-center gap-2 flex-wrap">
					<Button
						variant="outline"
						size="sm"
						className="text-xs h-8"
						disabled={batch.running}
						onClick={() =>
							setSelected((prev) =>
								prev.size === importable.length
									? new Set()
									: new Set(importable.map((p) => p.lib)),
							)
						}
					>
						{selected.size === importable.length
							? "Deselect page"
							: `Select page (${importable.length})`}
					</Button>
					{selected.size > 0 && (
						<Button
							size="sm"
							className="h-8"
							onClick={importSelected}
							disabled={batch.running}
						>
							{batch.running ? (
								<Loader2 className="w-4 h-4 animate-spin mr-1" />
							) : (
								<Download className="w-4 h-4 mr-1" />
							)}
							Import {selected.size} selected
						</Button>
					)}
					{batch.progress && (
						<BatchImportProgress
							progress={batch.progress}
							onCancel={batch.cancel}
						/>
					)}
				</div>
			)}

			{error && <ImportErrorBanner error={error} />}

			{!loading && items.length === 0 && !error && (
				<div className="text-center py-12 text-muted-foreground">
					<Shirt className="w-12 h-12 mx-auto mb-3 opacity-50" />
					<p className="text-sm">
						No libraries found{activeSearch ? ` for "${activeSearch}"` : ""}
					</p>
				</div>
			)}

			{items.length > 0 && (
				<div
					className={cn(
						"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
						loading && "opacity-50",
					)}
				>
					{items.map((p) => {
						const isSelected = selected.has(p.lib);
						return (
							<div
								key={p.lib}
								className={cn(
									"rounded-lg border overflow-hidden bg-card relative hover:border-border transition-all",
									p.nitroExists && "ring-1 ring-[var(--admin-success)]/30",
									isSelected && "ring-2 ring-primary border-primary",
								)}
							>
								{!p.nitroExists && (
									<button
										type="button"
										onClick={() => toggle(p.lib)}
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
								<div className="flex items-center justify-center h-28 bg-accent/20">
									<AvatarPreview type={p.previewType} id={p.previewId} />
								</div>
								<div className="px-2.5 py-2 border-t space-y-1">
									<div className="text-xs font-bold truncate" title={p.lib}>
										{p.lib}
									</div>
									<div className="pt-1">
										{p.nitroExists ? (
											<div className="flex items-center gap-1">
												<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 flex-1 justify-center">
													<Check className="w-2.5 h-2.5" />
													Imported
												</Badge>
												<Button
													variant="ghost"
													size="sm"
													className="h-5 w-5 p-0 shrink-0"
													title="Remove library"
													disabled={busyLib === p.lib || batch.running}
													onClick={() => remove(p)}
												>
													<Trash2 className="w-3 h-3" />
												</Button>
											</div>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="w-full text-xs h-7"
												disabled={busyLib === p.lib || batch.running}
												onClick={() => importOne(p)}
											>
												{busyLib === p.lib ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Download className="w-3 h-3 mr-1" />
												)}
												Import
											</Button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{total > PER_PAGE && (
				<div className="flex items-center justify-between">
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

// ── Vestiti / Sets (v2) view ──────────────────────────────────────────────────

function SetsView() {
	const [searchTerm, setSearchTerm] = useState("");
	const [activeSearch, setActiveSearch] = useState("");
	const [items, setItems] = useState<ClothingSetItem[]>([]);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const batch = useBatchImport({
		url: "/cms_api/admin/import/clothing/sets/batch",
		successAction: "sets imported",
		cancelledMessage: "Import cancelled",
		onItemDone: (label) => markDone(label),
		onComplete: () => setSelected(new Set()),
	});

	function itemKey(it: ClothingSetItem): string {
		return `${it.setType}-${it.setId}`;
	}

	const fetchItems = useCallback(async (search: string, pageNum: number) => {
		setLoading(true);
		setError("");
		try {
			const params = new URLSearchParams({ page: String(pageNum) });
			if (search) params.set("search", search);
			const res = await adminFetch(`/cms_api/admin/import/clothing/sets?${params}`);
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Failed to load");
				return;
			}
			setItems(data.items || []);
			setTotal(data.meta?.total || 0);
			setSelected(new Set());
		} catch {
			setError("Network error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchItems("", 1);
	}, [fetchItems]);

	function doSearch() {
		setActiveSearch(searchTerm);
		setPage(1);
		fetchItems(searchTerm, 1);
	}

	function goPage(dir: "prev" | "next") {
		const next = dir === "next" ? page + 1 : Math.max(1, page - 1);
		setPage(next);
		fetchItems(activeSearch, next);
	}

	const importable = useMemo(() => items.filter((it) => !it.present), [items]);
	const presentCount = useMemo(
		() => items.filter((it) => it.present).length,
		[items],
	);
	const lastPage = Math.max(Math.ceil(total / PER_PAGE), 1);

	function toggle(key: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(key)) n.delete(key);
			else n.add(key);
			return n;
		});
	}

	function markDone(label: string) {
		setItems((prev) =>
			prev.map((it) => (itemKey(it) === label ? { ...it, present: true } : it)),
		);
	}

	async function importViaSse(toImport: ClothingSetItem[]) {
		await batch.run(
			toImport.map((it) => itemKey(it)),
			{
				items: toImport.map((it) => ({
					setType: it.setType,
					setId: it.setId,
				})),
				concurrency: 3,
			},
		);
	}

	async function importOne(it: ClothingSetItem) {
		const key = itemKey(it);
		setBusyKey(key);
		try {
			await importViaSse([it]);
		} finally {
			setBusyKey(null);
		}
	}

	async function importSelected() {
		const toImport = items.filter(
			(it) => selected.has(itemKey(it)) && !it.present,
		);
		if (toImport.length === 0) return;
		await importViaSse(toImport);
	}

	return (
		<div className="space-y-4">
			{(items.length > 0 || total > 0) && (
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{total}</span>
						<span className="text-muted-foreground">sets</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Check className="h-4 w-4 text-[var(--admin-success)]" />
						<span className="font-medium text-[var(--admin-success)]">
							{presentCount}
						</span>
						<span className="text-muted-foreground">on this page</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Download className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{importable.length}</span>
						<span className="text-muted-foreground">missing here</span>
					</div>
				</div>
			)}

			<div className="flex gap-2 flex-wrap">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search by set id or type (e.g. hr, ch, 1027)..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") doSearch();
							if (e.key === "Escape") {
								setSearchTerm("");
								setActiveSearch("");
								setPage(1);
								fetchItems("", 1);
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
								fetchItems("", 1);
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

			{importable.length > 0 && (
				<div className="flex items-center gap-2 flex-wrap">
					<Button
						variant="outline"
						size="sm"
						className="text-xs h-8"
						disabled={batch.running}
						onClick={() =>
							setSelected((prev) =>
								prev.size === importable.length
									? new Set()
									: new Set(importable.map((it) => itemKey(it))),
							)
						}
					>
						{selected.size === importable.length
							? "Deselect page"
							: `Select page (${importable.length})`}
					</Button>
					{selected.size > 0 && (
						<Button
							size="sm"
							className="h-8"
							onClick={importSelected}
							disabled={batch.running}
						>
							{batch.running ? (
								<Loader2 className="w-4 h-4 animate-spin mr-1" />
							) : (
								<Download className="w-4 h-4 mr-1" />
							)}
							Import {selected.size} selected
						</Button>
					)}
					{batch.progress && (
						<BatchImportProgress
							progress={batch.progress}
							onCancel={batch.cancel}
						/>
					)}
				</div>
			)}

			{error && <ImportErrorBanner error={error} />}

			{!loading && items.length === 0 && !error && (
				<div className="text-center py-12 text-muted-foreground">
					<Shirt className="w-12 h-12 mx-auto mb-3 opacity-50" />
					<p className="text-sm">
						No sets found{activeSearch ? ` for "${activeSearch}"` : ""}
					</p>
				</div>
			)}

			{items.length > 0 && (
				<div
					className={cn(
						"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
						loading && "opacity-50",
					)}
				>
					{items.map((it) => {
						const key = itemKey(it);
						const isSelected = selected.has(key);
						return (
							<div
								key={key}
								className={cn(
									"rounded-lg border overflow-hidden bg-card relative hover:border-border transition-all",
									it.present && "ring-1 ring-[var(--admin-success)]/30",
									isSelected && "ring-2 ring-primary border-primary",
								)}
							>
								{!it.present && (
									<button
										type="button"
										onClick={() => toggle(key)}
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
								<div className="flex items-center justify-center h-28 bg-accent/20">
									<AvatarPreview type={it.setType} id={it.setId} />
								</div>
								<div className="px-2.5 py-2 border-t space-y-1">
									<div className="text-xs font-bold truncate" title={key}>
										{it.setType}-{it.setId}
									</div>
									<div className="flex items-center gap-1 flex-wrap">
										<Badge
											variant="outline"
											className="text-[10px] px-1.5 py-0"
										>
											{it.gender}
										</Badge>
										{it.club > 0 && (
											<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)] border-0">
												HC
											</Badge>
										)}
										{it.sellable && (
											<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-info-subtle)] text-[var(--admin-info)] border-0">
												$
											</Badge>
										)}
									</div>
									<div className="pt-1">
										{it.present ? (
											<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 w-full justify-center">
												<Check className="w-2.5 h-2.5" />
												Imported
											</Badge>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="w-full text-xs h-7"
												disabled={busyKey === key || batch.running}
												onClick={() => importOne(it)}
											>
												{busyKey === key ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Download className="w-3 h-3 mr-1" />
												)}
												Import
											</Button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{total > PER_PAGE && (
				<div className="flex items-center justify-between">
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

// ── Root component with mode toggle ──────────────────────────────────────────

export function ImportClothingClient() {
	const [mode, setMode] = useState<Mode>("libs");

	return (
		<div className="space-y-4">
			<div className="flex gap-1 rounded-lg border p-1 w-fit">
				<Button
					size="sm"
					variant={mode === "libs" ? "default" : "ghost"}
					className="h-7 text-xs"
					onClick={() => setMode("libs")}
				>
					Libraries
				</Button>
				<Button
					size="sm"
					variant={mode === "sets" ? "default" : "ghost"}
					className="h-7 text-xs"
					onClick={() => setMode("sets")}
				>
					Sets
				</Button>
			</div>

			{mode === "libs" ? <LibsView /> : <SetsView />}
		</div>
	);
}
