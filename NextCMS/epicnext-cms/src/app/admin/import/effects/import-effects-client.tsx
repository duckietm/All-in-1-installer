// src/app/[locale]/admin/import/effects/import-effects-client.tsx
"use client";

import {
	Check,
	Download,
	Loader2,
	Music,
	Package,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

interface EffectItem {
	id: string;
	lib: string;
	type: string;
	revision: number;
	present: boolean;
	nitroExists: boolean;
}

type Filter = "all" | "fx" | "dance";

export function ImportEffectsClient() {
	const [searchTerm, setSearchTerm] = useState("");
	const [effects, setEffects] = useState<EffectItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busyLib, setBusyLib] = useState<string | null>(null);
	const batch = useBatchImport({
		url: "/cms_api/admin/import/effects/batch",
		successAction: "effect(s) imported",
		cancelledMessage: "Import cancelled",
		onItemDone: (lib) => markDone(lib),
		onComplete: () => setSelected(new Set()),
	});

	const fetchEffects = useCallback(async (search: string) => {
		setLoading(true);
		setError("");
		try {
			const params = new URLSearchParams();
			if (search) params.set("search", search);
			const res = await adminFetch(`/cms_api/admin/import/effects?${params}`);
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Failed to load");
				return;
			}
			setEffects(data.effects || []);
			setSelected(new Set());
		} catch {
			setError("Network error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchEffects("");
	}, [fetchEffects]);

	const visible = useMemo(
		() => effects.filter((e) => filter === "all" || e.type === filter),
		[effects, filter],
	);
	const importable = useMemo(
		() => visible.filter((e) => !e.present || !e.nitroExists),
		[visible],
	);
	const importedCount = useMemo(
		() => visible.filter((e) => e.present && e.nitroExists).length,
		[visible],
	);

	function toggle(lib: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(lib)) n.delete(lib);
			else n.add(lib);
			return n;
		});
	}

	function markDone(lib: string) {
		setEffects((prev) =>
			prev.map((e) =>
				e.lib === lib ? { ...e, present: true, nitroExists: true } : e,
			),
		);
	}

	async function importViaSse(items: EffectItem[]) {
		await batch.run(
			items.map((e) => e.lib),
			{ items, concurrency: 3 },
		);
	}

	async function importOne(e: EffectItem) {
		setBusyLib(e.lib);
		try {
			await importViaSse([e]);
		} finally {
			setBusyLib(null);
		}
	}

	async function importSelected() {
		const items = visible.filter(
			(e) => selected.has(e.lib) && (!e.present || !e.nitroExists),
		);
		if (items.length === 0) return;
		await importViaSse(items);
	}

	async function remove(e: EffectItem) {
		setBusyLib(e.lib);
		try {
			const res = await adminFetch(
				`/cms_api/admin/import/effects?lib=${encodeURIComponent(e.lib)}`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (res.ok) {
				toast.success(`${e.lib} removed`);
				setEffects((prev) =>
					prev.map((x) =>
						x.lib === e.lib ? { ...x, present: false, nitroExists: false } : x,
					),
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
			{/* Stats */}
			{effects.length > 0 && (
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{visible.length}</span>
						<span className="text-muted-foreground">effects</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Check className="h-4 w-4 text-[var(--admin-success)]" />
						<span className="font-medium text-[var(--admin-success)]">
							{importedCount}
						</span>
						<span className="text-muted-foreground">imported</span>
					</div>
					<div className="flex items-center gap-1.5 text-sm">
						<Download className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium">{importable.length}</span>
						<span className="text-muted-foreground">available</span>
					</div>
				</div>
			)}

			{/* Search + filter */}
			<div className="flex gap-2 flex-wrap">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search effects by lib / id..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") fetchEffects(searchTerm);
							if (e.key === "Escape") {
								setSearchTerm("");
								fetchEffects("");
							}
						}}
						className="pl-9 pr-8"
					/>
					{searchTerm && (
						<button
							type="button"
							onClick={() => {
								setSearchTerm("");
								fetchEffects("");
							}}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<Button
					onClick={() => fetchEffects(searchTerm)}
					size="sm"
					disabled={loading}
				>
					{loading ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Search className="w-4 h-4" />
					)}
				</Button>
				{(["all", "fx", "dance"] as Filter[]).map((f) => (
					<Button
						key={f}
						size="sm"
						variant={filter === f ? "default" : "outline"}
						onClick={() => setFilter(f)}
					>
						{f.toUpperCase()}
					</Button>
				))}
			</div>

			{/* Bulk actions */}
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
									: new Set(importable.map((e) => e.lib)),
							)
						}
					>
						{selected.size === importable.length
							? "Deselect All"
							: `Select All (${importable.length})`}
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

			{/* Error */}
			{error && <ImportErrorBanner error={error} />}

			{/* Empty */}
			{!loading && visible.length === 0 && !error && (
				<div className="text-center py-12 text-muted-foreground">
					<Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
					<p className="text-sm">No effects found</p>
				</div>
			)}

			{/* Grid */}
			{visible.length > 0 && (
				<div
					className={cn(
						"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
						loading && "opacity-50",
					)}
				>
					{visible.map((e) => {
						const imported = e.present && e.nitroExists;
						const isSelected = selected.has(e.lib);
						return (
							<div
								key={e.lib}
								className={cn(
									"rounded-lg border overflow-hidden bg-card relative hover:border-border transition-all",
									imported && "ring-1 ring-[var(--admin-success)]/30",
									isSelected && "ring-2 ring-primary border-primary",
								)}
							>
								{!imported && (
									<button
										type="button"
										onClick={() => toggle(e.lib)}
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
								<div
									className={cn(
										"flex flex-col items-center justify-center h-20 gap-1",
										e.type === "dance"
											? "bg-gradient-to-br from-[var(--admin-warning)]/25 to-[var(--admin-warning)]/10"
											: "bg-gradient-to-br from-[var(--admin-accent)]/25 to-[var(--admin-accent)]/10",
									)}
								>
									{e.type === "dance" ? (
										<Music className="w-7 h-7 text-[var(--admin-warning)]/80" />
									) : (
										<Sparkles className="w-7 h-7 text-[var(--admin-accent-text)]" />
									)}
									<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
										{e.type}
									</span>
								</div>
								<div className="px-2.5 py-2 border-t space-y-1">
									<div className="text-xs font-bold truncate">{e.lib}</div>
									<div className="text-[10px] text-muted-foreground truncate">
										id {e.id}
									</div>
									<div className="pt-1">
										{imported ? (
											<div className="flex items-center gap-1">
												<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 flex-1 justify-center">
													<Check className="w-2.5 h-2.5" />
													Imported
												</Badge>
												<Button
													variant="ghost"
													size="sm"
													className="h-5 w-5 p-0 shrink-0"
													title="Remove effect"
													disabled={busyLib === e.lib || batch.running}
													onClick={() => remove(e)}
												>
													<Trash2 className="w-3 h-3" />
												</Button>
											</div>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="w-full text-xs h-7"
												disabled={busyLib === e.lib || batch.running}
												onClick={() => importOne(e)}
											>
												{busyLib === e.lib ? (
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
		</div>
	);
}
