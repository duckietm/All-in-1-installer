"use client";

import {
	BadgeCheck,
	Check,
	CheckCircle2,
	Download,
	Globe,
	Loader2,
	Package,
	Pencil,
	Search,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImportErrorBanner } from "@/components/admin/import-error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { adminFetch } from "@/lib/admin-fetch";
import { cn } from "@/lib/utils";
import { BadgeEditorDialog } from "./badge-editor-dialog";

interface BadgeItem {
	id: number;
	code: string;
	name: string;
	description: string;
	hotel: string;
	url_habbo: string;
	url_habboassets: string;
	alreadyImported: boolean;
}

const PAGE_SIZE = 100;

export function ImportBadgesClient() {
	const [searchTerm, setSearchTerm] = useState("");
	const [activeSearch, setActiveSearch] = useState("");
	const [badges, setBadges] = useState<BadgeItem[]>([]);
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [importingCode, setImportingCode] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [allHotels, setAllHotels] = useState(true);
	const [editingCode, setEditingCode] = useState<string | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [batchImporting, setBatchImporting] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	const fetchBadges = useCallback(
		async (search: string, off: number, all: boolean) => {
			setLoading(true);
			setError("");
			try {
				const params = new URLSearchParams({ offset: String(off) });
				if (search) params.set("search", search);
				if (all) params.set("allHotels", "1");
				const res = await fetch(`/cms_api/admin/import/badges?${params}`);
				const data = await res.json();
				if (!res.ok) {
					setError(data.error || "Failed to load");
					return;
				}
				const list = data.badges || [];
				setBadges(list);
				setHasMore(list.length >= PAGE_SIZE);
				setSelected(new Set());
			} catch {
				setError("Network error");
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	// Auto-load on mount and when allHotels changes
	useEffect(() => {
		setOffset(0);
		fetchBadges(activeSearch, 0, allHotels);
	}, [fetchBadges, allHotels, activeSearch]);

	// "/" keyboard shortcut to focus search
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const tag = (e.target as HTMLElement)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
				e.preventDefault();
				searchRef.current?.focus();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	function doSearch() {
		setActiveSearch(searchTerm);
		setOffset(0);
		fetchBadges(searchTerm, 0, allHotels);
	}

	function goPage(direction: "prev" | "next") {
		const newOffset =
			direction === "next"
				? offset + PAGE_SIZE
				: Math.max(0, offset - PAGE_SIZE);
		setOffset(newOffset);
		fetchBadges(activeSearch, newOffset, allHotels);
	}

	async function postImportBadge(badge: BadgeItem) {
		const res = await adminFetch("/cms_api/admin/import/badges", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				code: badge.code,
				name: badge.name,
				description: badge.description,
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return {
				ok: false as const,
				error:
					(data as { error?: string }).error ||
					`Failed to import ${badge.code}`,
			};
		}
		return { ok: true as const };
	}

	async function doImport(badge: BadgeItem) {
		setImportingCode(badge.code);
		try {
			const result = await postImportBadge(badge);
			if (result.ok) {
				toast.success(`${badge.code} imported`);
				setBadges((prev) =>
					prev.map((b) =>
						b.code === badge.code ? { ...b, alreadyImported: true } : b,
					),
				);
				setSelected((prev) => {
					const n = new Set(prev);
					n.delete(badge.code);
					return n;
				});
			} else {
				toast.error(result.error);
			}
		} catch {
			toast.error(`Network error importing ${badge.code}`);
		} finally {
			setImportingCode(null);
		}
	}

	async function doBatchImport() {
		const toImport = badges.filter(
			(b) => selected.has(b.code) && !b.alreadyImported,
		);
		if (toImport.length === 0) return;
		setBatchImporting(true);
		let ok = 0,
			fail = 0;
		for (const badge of toImport) {
			try {
				const result = await postImportBadge(badge);
				if (result.ok) {
					ok++;
					setBadges((prev) =>
						prev.map((b) =>
							b.code === badge.code ? { ...b, alreadyImported: true } : b,
						),
					);
				} else {
					fail++;
				}
			} catch {
				fail++;
			}
		}
		setBatchImporting(false);
		setSelected(new Set());
		if (ok > 0) toast.success(`${ok} badge(s) imported`);
		if (fail > 0) toast.error(`${fail} failed`);
	}

	function toggleSelect(code: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(code)) next.delete(code);
			else next.add(code);
			return next;
		});
	}

	const importableBadges = useMemo(
		() => badges.filter((b) => !b.alreadyImported),
		[badges],
	);

	function toggleSelectAll() {
		if (selected.size === importableBadges.length) {
			setSelected(new Set());
		} else {
			setSelected(new Set(importableBadges.map((b) => b.code)));
		}
	}

	// Stats
	const importedCount = useMemo(
		() => badges.filter((b) => b.alreadyImported).length,
		[badges],
	);
	const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

	return (
		<TooltipProvider delayDuration={300}>
			<div className="space-y-4">
				{/* Stats bar */}
				{badges.length > 0 && (
					<div className="flex items-center gap-3 flex-wrap">
						<div className="flex items-center gap-1.5 text-sm">
							<Package className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium">{badges.length}</span>
							<span className="text-muted-foreground">results</span>
						</div>
						<div className="flex items-center gap-1.5 text-sm">
							<CheckCircle2 className="h-4 w-4 text-[var(--admin-success)]" />
							<span className="font-medium text-[var(--admin-success)]">
								{importedCount}
							</span>
							<span className="text-muted-foreground">imported</span>
						</div>
						{importableBadges.length > 0 && (
							<div className="flex items-center gap-1.5 text-sm">
								<Download className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">{importableBadges.length}</span>
								<span className="text-muted-foreground">available</span>
							</div>
						)}
					</div>
				)}

				{/* Search bar */}
				<div className="flex gap-2">
					<div className="relative flex-1 max-w-md">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							ref={searchRef}
							placeholder="Search badges by name...  /"
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") doSearch();
								if (e.key === "Escape") {
									setSearchTerm("");
									searchRef.current?.blur();
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
									fetchBadges("", 0, allHotels);
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
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={allHotels ? "default" : "outline"}
								size="sm"
								onClick={() => setAllHotels((v) => !v)}
							>
								<Globe className="w-4 h-4 mr-1" />
								{allHotels ? "All" : "IT"}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>
								{allHotels
									? "Showing all hotels — click for Italian only"
									: "Showing Italian only — click for all hotels"}
							</p>
						</TooltipContent>
					</Tooltip>
				</div>

				{/* Bulk actions */}
				{importableBadges.length > 0 && (
					<div className="flex items-center gap-2 flex-wrap">
						<Button
							variant="outline"
							size="sm"
							onClick={toggleSelectAll}
							className="text-xs h-8"
							disabled={batchImporting}
						>
							{selected.size === importableBadges.length
								? "Deselect All"
								: `Select All (${importableBadges.length})`}
						</Button>
						{selected.size > 0 && (
							<Button
								size="sm"
								className="h-8"
								onClick={doBatchImport}
								disabled={batchImporting}
							>
								{batchImporting ? (
									<Loader2 className="w-4 h-4 animate-spin mr-1" />
								) : (
									<Download className="w-4 h-4 mr-1" />
								)}
								Import {selected.size} selected
							</Button>
						)}
					</div>
				)}

				{/* Error */}
				{error && <ImportErrorBanner error={error} />}

				{/* Loading skeleton */}
				{loading && badges.length === 0 && (
					<div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
						{Array.from({ length: 18 }, (_, i) => i).map((n) => (
							<div
								key={`skeleton-badge-${n}`}
								className="rounded-lg border bg-card p-3 animate-pulse"
							>
								<div className="h-12 w-12 bg-muted rounded mx-auto mb-2" />
								<div className="h-4 bg-muted rounded w-3/4 mx-auto mb-1" />
								<div className="h-3 bg-muted rounded w-1/2 mx-auto mb-2" />
								<div className="h-7 bg-muted rounded" />
							</div>
						))}
					</div>
				)}

				{/* Empty state */}
				{!loading && badges.length === 0 && !error && (
					<div className="text-center py-12 text-muted-foreground">
						<BadgeCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p className="text-sm">
							No badges found{activeSearch ? ` for "${activeSearch}"` : ""}
						</p>
						{!activeSearch && (
							<p className="text-xs mt-1">
								Try searching by badge name or code
							</p>
						)}
					</div>
				)}

				{/* Badge grid */}
				{badges.length > 0 && (
					<div
						className={cn(
							"grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3",
							loading && "opacity-50",
						)}
					>
						{badges.map((badge) => {
							const isSelected = selected.has(badge.code);
							return (
								<div
									key={badge.code}
									className={cn(
										"rounded-lg border overflow-hidden bg-card group relative hover:border-border transition-all",
										badge.alreadyImported &&
											"ring-1 ring-[var(--admin-success)]/30",
										isSelected && "ring-2 ring-primary border-primary",
									)}
								>
									{/* Checkbox for non-imported */}
									{!badge.alreadyImported && (
										<button
											type="button"
											onClick={() => toggleSelect(badge.code)}
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

									{/* Badge image area */}
									<div className="flex items-center justify-center h-20 bg-accent/20">
										<img
											src={badge.url_habbo}
											alt={badge.code}
											className="image-pixelated drop-shadow-sm"
											style={{ maxHeight: 48, maxWidth: 48 }}
											onError={(e) => {
												const img = e.target as HTMLImageElement;
												if (!img.dataset.fallback) {
													img.dataset.fallback = "1";
													img.src = badge.url_habboassets;
												} else {
													img.style.opacity = "0.3";
												}
											}}
										/>
									</div>

									{/* Info */}
									<div className="px-2.5 py-2 border-t space-y-1">
										<div className="text-xs font-bold truncate">
											{badge.code}
										</div>
										{badge.name && (
											<Tooltip>
												<TooltipTrigger asChild>
													<div className="text-[11px] text-muted-foreground truncate cursor-default">
														{badge.name}
													</div>
												</TooltipTrigger>
												<TooltipContent side="bottom" className="max-w-64">
													<p className="font-medium">{badge.name}</p>
													{badge.description && (
														<p className="text-muted-foreground text-xs mt-1">
															{badge.description}
														</p>
													)}
												</TooltipContent>
											</Tooltip>
										)}
										{allHotels && badge.hotel && (
											<Badge variant="outline" className="text-[9px] px-1 h-4">
												{badge.hotel.toUpperCase()}
											</Badge>
										)}

										{/* Action */}
										<div className="pt-1">
											{badge.alreadyImported ? (
												<div className="flex items-center gap-1">
													<Badge className="text-[10px] px-1.5 py-0 bg-[var(--admin-success-subtle)] text-[var(--admin-success)] border-0 gap-0.5 flex-1 justify-center">
														<Check className="w-2.5 h-2.5" />
														Imported
													</Badge>
													<Button
														variant="ghost"
														size="sm"
														className="h-5 w-5 p-0 shrink-0"
														title="Edit badge name/description"
														onClick={() => setEditingCode(badge.code)}
													>
														<Pencil className="w-3 h-3" />
													</Button>
												</div>
											) : (
												<Button
													size="sm"
													variant="outline"
													className="w-full text-xs h-7"
													onClick={() => doImport(badge)}
													disabled={
														importingCode === badge.code || batchImporting
													}
												>
													{importingCode === badge.code ? (
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

				{/* Pagination */}
				{(offset > 0 || hasMore) && (
					<div className="flex items-center justify-between">
						<span className="text-sm text-muted-foreground">
							Page {currentPage}
						</span>
						<div className="flex gap-1">
							<Button
								variant="outline"
								size="sm"
								disabled={offset <= 0 || loading}
								onClick={() => goPage("prev")}
							>
								&larr; Prev
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!hasMore || loading}
								onClick={() => goPage("next")}
							>
								Next &rarr;
							</Button>
						</div>
					</div>
				)}

				{/* Badge Editor Dialog */}
				<BadgeEditorDialog
					code={editingCode ?? ""}
					open={!!editingCode}
					onOpenChange={(open) => {
						if (!open) setEditingCode(null);
					}}
				/>
			</div>
		</TooltipProvider>
	);
}
