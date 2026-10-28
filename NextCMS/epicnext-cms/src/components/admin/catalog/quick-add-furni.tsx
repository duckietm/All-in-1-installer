"use client";

import { Loader2, Package, Search, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createCatalogItem } from "@/actions/catalog-items";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { logger } from "@/lib/browser-log";
import { getHabboCdnIconUrl, getLocalIconUrl } from "@/lib/furni/classname";

interface FurniResult {
	id: number;
	itemName: string;
	publicName: string;
	type: string;
	spriteId: number;
}

interface QuickAddFurniProps {
	pageId: number;
	furniRevisionMap: Record<number, { classname: string; revision: number }>;
}

export function QuickAddFurni({
	pageId,
	furniRevisionMap,
}: QuickAddFurniProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [results, setResults] = useState<FurniResult[]>([]);
	const [loading, setLoading] = useState(false);
	const { run, isPending } = useServerAction();
	const inputRef = useRef<HTMLInputElement>(null);

	// Keyboard shortcut: Ctrl+K / Cmd+K
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				const tag = (e.target as HTMLElement)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA") return;
				e.preventDefault();
				setOpen(true);
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// Debounce search
	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);

	// Focus input when opened
	useEffect(() => {
		if (open) setTimeout(() => inputRef.current?.focus(), 50);
	}, [open]);

	// Fetch results
	useEffect(() => {
		if (!open || debounced.length < 2) {
			setResults([]);
			return;
		}
		setLoading(true);
		const ac = new AbortController();
		fetch(
			`/api/admin/furni/search?q=${encodeURIComponent(debounced)}&limit=30`,
			{
				signal: ac.signal,
			},
		)
			.then((r) => r.json())
			.then((data) => setResults(data.results ?? []))
			.catch((error) =>
				logger.error("[QuickAdd] Furni search failed", {
					err: error as Error,
				}),
			)
			.finally(() => setLoading(false));
		return () => ac.abort();
	}, [debounced, open]);

	const handleAdd = useCallback(
		(base: FurniResult) => {
			run(
				() =>
					createCatalogItem({
						pageId,
						itemIds: String(base.id),
						catalogName: base.publicName || base.itemName,
						costCredits: 0,
						costPoints: 0,
						pointsType: 0,
						amount: 1,
						limitedSells: 0,
						limitedStack: 0,
						orderNumber: 1,
						offerId: -1,
						songId: 0,
						haveOffer: "1",
						clubOnly: "0",
						extradata: "",
					}),
				{
					successMessage: `Added "${base.publicName || base.itemName}" to page.`,
					errorMessage: "Failed to add item.",
					onSuccess: () => {
						toast.success(`Added #${base.id}`);
					},
				},
			);
		},
		[pageId, run],
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button variant="outline" size="sm" onClick={() => setOpen(true)}>
				<Zap className="mr-2 h-4 w-4" />
				Quick Add
				<kbd className="ml-2 hidden rounded border bg-muted px-1 text-[10px] sm:inline">
					Ctrl+K
				</kbd>
			</Button>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Quick Add Furni</DialogTitle>
				</DialogHeader>

				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						ref={inputRef}
						placeholder="Search by item name or public name..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="pl-9"
					/>
					{loading && (
						<Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
					)}
				</div>

				<div className="max-h-[420px] overflow-y-auto rounded-md border">
					{debounced.length < 2 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Type at least 2 characters to search
						</p>
					) : results.length === 0 && !loading ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							No furni found for &quot;{debounced}&quot;
						</p>
					) : (
						<div className="divide-y">
							{results.map((r) => {
								const furni = furniRevisionMap[r.id];
								return (
									<button
										key={r.id}
										type="button"
										onClick={() => handleAdd(r)}
										disabled={isPending}
										className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
									>
										<FurniThumb
											classname={furni?.classname ?? r.itemName}
											revision={furni?.revision ?? 0}
										/>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{r.publicName || (
													<span className="italic text-muted-foreground">
														{r.itemName}
													</span>
												)}
											</p>
											<p className="truncate font-mono text-[11px] text-muted-foreground">
												#{r.id} · {r.itemName} · {r.type}
											</p>
										</div>
										<span className="shrink-0 text-xs text-muted-foreground">
											Add →
										</span>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function FurniThumb({
	classname,
	revision,
}: {
	classname: string;
	revision: number;
}) {
	if (!classname) {
		return (
			<div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
				<Package className="h-4 w-4 text-muted-foreground" />
			</div>
		);
	}
	const primary = getLocalIconUrl(classname);

	function handleError(e: React.SyntheticEvent<HTMLImageElement>) {
		const img = e.target as HTMLImageElement;
		if (!img.dataset.fallback && revision > 0) {
			img.dataset.fallback = "cdn";
			img.src = getHabboCdnIconUrl(classname, revision);
		} else {
			img.style.opacity = "0";
		}
	}

	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted/50">
			<img
				src={primary}
				alt={classname}
				className="max-h-full max-w-full object-contain"
				style={{ imageRendering: "pixelated" }}
				onError={handleError}
				loading="lazy"
			/>
		</div>
	);
}
