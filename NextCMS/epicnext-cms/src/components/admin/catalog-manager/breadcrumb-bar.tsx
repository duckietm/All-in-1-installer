"use client";

import { ChevronRight, Home } from "lucide-react";
import { Fragment, useEffect } from "react";
import { logger } from "@/lib/browser-log";
import { useCatalogManager } from "./use-catalog-store";

export function BreadcrumbBar({
	onSelectPage,
}: {
	onSelectPage: (id: number) => void;
}) {
	const { state, dispatch, catalogType } = useCatalogManager();
	const { selectedPageId, ancestors } = state;
	const catQs = catalogType === "bc" ? "&catalog=bc" : "";

	useEffect(() => {
		if (!selectedPageId || selectedPageId <= 0) {
			dispatch({ type: "SET_ANCESTORS", ancestors: [] });
			return;
		}
		const ac = new AbortController();
		fetch(`/api/admin/catalog/tree?ancestors=${selectedPageId}${catQs}`, {
			signal: ac.signal,
		})
			.then((r) => r.json())
			.then((d) => {
				if (!ac.signal.aborted) {
					dispatch({ type: "SET_ANCESTORS", ancestors: d.ancestors ?? [] });
				}
			})
			.catch((error) =>
				logger.error("[Breadcrumb] Failed to fetch ancestors", {
					err: error as Error,
				}),
			);
		return () => ac.abort();
	}, [selectedPageId, dispatch, catQs]);

	if (!selectedPageId || ancestors.length === 0) return null;

	return (
		<div className="flex items-center gap-1 px-4 py-1 border-b bg-muted/20 text-xs text-muted-foreground overflow-x-auto shrink-0">
			<Home className="h-3 w-3 shrink-0" />
			{ancestors.map((a) => (
				<Fragment key={a.id}>
					<ChevronRight className="h-3 w-3 shrink-0" />
					<button
						type="button"
						onClick={() => onSelectPage(a.id)}
						className="shrink-0 hover:text-foreground transition-colors truncate max-w-40"
					>
						{a.caption}
					</button>
				</Fragment>
			))}
			{/* Current page */}
			{(() => {
				const node = state.nodes.get(selectedPageId);
				if (!node) return null;
				return (
					<>
						<ChevronRight className="h-3 w-3 shrink-0" />
						<span className="shrink-0 text-foreground font-medium truncate max-w-40">
							{node.caption}
						</span>
					</>
				);
			})()}
		</div>
	);
}
