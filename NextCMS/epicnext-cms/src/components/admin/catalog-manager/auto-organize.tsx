"use client";

import { ArrowDownUp, Loader2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { reorderCatalogItems } from "@/actions/catalog-items";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	buildSortOrders,
	SORT_STRATEGIES,
	type SortStrategy,
	sortCatalogItems,
	suggestCatalogLayout,
} from "@/features/catalog/domain/organize";

interface AutoOrganizeProps {
	items: CatalogItemData[];
	currentLayout: string;
	canEdit?: boolean;
	onSorted: () => void;
	onApplyLayout: (layout: string) => void;
}

/**
 * One-click organizational helpers: pick a smart sort order and apply it,
 * or apply the suggested layout for this page's offers.
 */
export function AutoOrganize({
	items,
	currentLayout,
	canEdit,
	onSorted,
	onApplyLayout,
}: AutoOrganizeProps) {
	const [strategy, setStrategy] = useState<SortStrategy>("name-asc");
	const [sorting, setSorting] = useState(false);

	const suggestion = items.length > 0 ? suggestCatalogLayout(items) : null;
	const showSuggestion =
		suggestion !== null && suggestion.layout !== currentLayout;

	const disabled = !canEdit || items.length === 0;

	async function handleSmartSort() {
		if (!canEdit || items.length === 0 || sorting) return;
		setSorting(true);
		try {
			const ordered = sortCatalogItems(items, strategy);
			const orders = buildSortOrders(ordered);
			const result = await reorderCatalogItems({ orders });
			if (!result.ok) throw new Error("Failed to sort");
			toast.success(
				`Sorted ${items.length} offers (${SORT_STRATEGIES.find((s) => s.id === strategy)?.label})`,
			);
			onSorted();
		} catch {
			toast.error("Failed to sort offers");
		} finally {
			setSorting(false);
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-[var(--admin-surface)] px-2 py-1.5">
			<span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--admin-text-muted)]">
				<Wand2 className="h-3 w-3" />
				Auto
			</span>
			<Select
				value={strategy}
				onValueChange={(v) => setStrategy(v as SortStrategy)}
				disabled={disabled}
			>
				<SelectTrigger className="h-7 w-36 text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{SORT_STRATEGIES.map((s) => (
						<SelectItem key={s.id} value={s.id} className="text-xs">
							{s.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-7 gap-1 text-xs"
				disabled={disabled || sorting}
				onClick={() => void handleSmartSort()}
			>
				{sorting ? (
					<Loader2 className="h-3 w-3 animate-spin" />
				) : (
					<ArrowDownUp className="h-3 w-3" />
				)}
				Sort
			</Button>
			{showSuggestion && suggestion && canEdit && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1 border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] text-[11px] text-[var(--admin-warning)] hover:bg-[var(--admin-warning-subtle)]"
					onClick={() => onApplyLayout(suggestion.layout)}
				>
					<Wand2 className="h-3 w-3" />
					Use {suggestion.layout} layout
				</Button>
			)}
		</div>
	);
}
