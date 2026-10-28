"use client";

import { Package } from "lucide-react";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import { cn } from "@/lib/utils";
import {
	getShopGridClass,
	getShopTileSize,
	parseFirstItemId,
	ShopTile,
} from "./shop-tile";

interface ItemsShopPreviewProps {
	items: CatalogItemData[];
	furniRevisionMap: Record<number, { classname: string; revision: number }>;
	layout: string;
	canEdit: boolean;
	onItemClick?: (item: CatalogItemData) => void;
}

/**
 * The preview is a visual check, not an editor. Mounting a tile (image, badges,
 * click handler) per offer made pages with hundreds of items crawl, so the grid
 * shows a window and states how many are hidden. The table view is the place to
 * work through the full list.
 */
const PREVIEW_TILE_LIMIT = 200;

export function ItemsShopPreview({
	items,
	furniRevisionMap,
	layout,
	canEdit,
	onItemClick,
}: ItemsShopPreviewProps) {
	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
				<Package className="h-10 w-10 text-muted-foreground/40" />
				<p className="mt-2 text-sm text-muted-foreground">
					No items in this page yet
				</p>
			</div>
		);
	}

	const gridClass = getShopGridClass(layout);
	const tileSize = getShopTileSize(layout);
	const visibleItems =
		items.length > PREVIEW_TILE_LIMIT
			? items.slice(0, PREVIEW_TILE_LIMIT)
			: items;

	return (
		<div className="rounded-lg border bg-gradient-to-b from-[var(--admin-surface)] to-[var(--admin-canvas)] p-4">
			<div className="mb-3 flex items-center justify-between text-xs text-[var(--admin-text-muted)]">
				<span className="font-medium">Shop preview · {layout}</span>
				<span>
					{items.length} items
					{visibleItems.length !== items.length &&
						` · showing first ${visibleItems.length}`}
				</span>
			</div>
			<div className={cn("grid gap-2", gridClass)}>
				{visibleItems.map((item) => {
					const firstId = parseFirstItemId(item.itemIds);
					const furni = firstId != null ? furniRevisionMap[firstId] : undefined;

					return (
						<ShopTile
							key={item.id}
							item={item}
							furni={furni}
							iconHeight={tileSize}
							canEdit={canEdit}
							onClick={onItemClick}
						/>
					);
				})}
			</div>
			{visibleItems.length !== items.length && (
				<p className="mt-3 text-center text-xs text-[var(--admin-text-muted)]">
					Preview capped at {PREVIEW_TILE_LIMIT} items — use the table view for
					the rest.
				</p>
			)}
		</div>
	);
}
