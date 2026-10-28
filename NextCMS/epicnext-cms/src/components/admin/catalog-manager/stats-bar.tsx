"use client";

import { FolderTree, Keyboard, Package, ToggleRight } from "lucide-react";
import { useCatalogManager } from "./use-catalog-store";

export interface CatalogStatsTotals {
	totalPages: number;
	enabledPages: number;
	totalItems: number;
}

export function StatsBar({ totals }: { totals?: CatalogStatsTotals | null }) {
	const { state } = useCatalogManager();
	const selected = state.multiSelectedIds.size;
	const rootTabs = state.rootPages.length;

	const pages = totals?.totalPages ?? state.nodes.size;
	const enabled = totals?.enabledPages ?? null;
	const items = totals?.totalItems ?? null;
	const loadedOnly = !totals;

	return (
		<div className="flex items-center justify-between gap-4 px-4 py-1.5 border-t bg-muted/30 text-[11px] text-muted-foreground shrink-0">
			<div className="flex items-center gap-4">
				<span className="flex items-center gap-1">
					<FolderTree className="h-3 w-3" />
					{rootTabs} root
				</span>
				<span>
					{pages} pages
					{loadedOnly ? " loaded" : ""}
				</span>
				{enabled !== null && (
					<span className="flex items-center gap-1">
						<ToggleRight className="h-3 w-3" />
						{enabled} enabled
					</span>
				)}
				{items !== null && (
					<span className="flex items-center gap-1">
						<Package className="h-3 w-3" />
						{items} items
					</span>
				)}
				{selected > 0 && (
					<span className="text-primary font-medium">{selected} selected</span>
				)}
			</div>
			<div className="flex items-center gap-1">
				<Keyboard className="h-3 w-3" />
				<span>
					<kbd className="rounded border bg-background px-1 font-mono text-[9px]">
						Ctrl+S
					</kbd>{" "}
					save
					<span className="mx-1">·</span>
					<kbd className="rounded border bg-background px-1 font-mono text-[9px]">
						/
					</kbd>{" "}
					search
					<span className="mx-1">·</span>
					<kbd className="rounded border bg-background px-1 font-mono text-[9px]">
						Ctrl+K
					</kbd>{" "}
					quick add
				</span>
			</div>
		</div>
	);
}
