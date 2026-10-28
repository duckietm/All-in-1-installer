"use client";

import { Crown, Package, Sparkles } from "lucide-react";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import { getPointsLabel } from "@/components/admin/catalog/catalog-items-table/types";
import {
	CurrencyIcon,
	currencyKindFromPointsType,
} from "@/components/shared/currency-icon";
import { Badge } from "@/components/ui/badge";
import { getHabboCdnIconUrl, getLocalIconUrl } from "@/lib/furni/classname";
import { cn } from "@/lib/utils";

/** Grid + tile sizing per page layout, shared by shop previews. */
export function getShopGridClass(layout: string): string {
	switch (layout) {
		case "spaces_new":
			return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
		case "frontpage":
			return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3";
		case "single_bundle":
		case "room_bundle":
			return "grid-cols-1 sm:grid-cols-2";
		case "pets":
		case "pets2":
		case "pets3":
			return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
		default:
			return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
	}
}

export function getShopTileSize(layout: string): number {
	switch (layout) {
		case "frontpage":
		case "single_bundle":
		case "room_bundle":
			return 140;
		case "spaces_new":
			return 110;
		default:
			return 96;
	}
}

export function parseFirstItemId(itemIds: string): number | null {
	if (!itemIds) return null;
	const first = itemIds.split(";")[0]?.trim();
	const n = parseInt(first, 10);
	return Number.isNaN(n) ? null : n;
}

interface ShopTileProps {
	item: CatalogItemData;
	furni?: { classname: string; revision: number } | null;
	/** Pixel height of the icon area. Defaults to a small standard tile. */
	iconHeight?: number;
	canEdit?: boolean;
	onClick?: (item: CatalogItemData) => void;
}

/** One purchasable offer tile exactly as it appears in the shop. */
export function ShopTile({
	item,
	furni,
	iconHeight = 96,
	canEdit,
	onClick,
}: ShopTileProps) {
	const points = getPointsLabel(item.pointsType);
	const isClub = item.clubOnly === "1";
	const isOffer = item.haveOffer === "1" && item.offerId > 0;
	const isLimited = item.limitedStack > 0;

	return (
		<button
			type="button"
			onClick={() => onClick?.(item)}
			disabled={!canEdit && !onClick}
			className={cn(
				"group relative flex flex-col overflow-hidden rounded-md border bg-card shadow-sm transition-all",
				canEdit &&
					"hover:border-primary hover:shadow-md hover:scale-[1.02] cursor-pointer",
				!canEdit && "cursor-default",
			)}
			title={item.catalogName || item.baseName}
		>
			{/* Tile icon */}
			<div
				className="relative flex items-center justify-center bg-gradient-to-br from-muted/30 to-muted/60"
				style={{ height: iconHeight }}
			>
				<ShopFurniIcon
					classname={furni?.classname ?? ""}
					revision={furni?.revision ?? 0}
					size={Math.floor(iconHeight * 0.7)}
				/>

				{/* Badges overlay */}
				<div className="absolute right-1 top-1 flex flex-col gap-0.5">
					{isClub && (
						<Badge className="h-4 gap-0.5 border-0 bg-[var(--admin-warning-subtle)] px-1 text-[8px] text-[var(--admin-warning)]">
							<Crown className="h-2.5 w-2.5" />
							HC
						</Badge>
					)}
					{isOffer && (
						<Badge className="h-4 gap-0.5 border-0 bg-[var(--admin-error)] px-1 text-[8px] text-[var(--admin-error-foreground)]">
							<Sparkles className="h-2.5 w-2.5" />
							OFFER
						</Badge>
					)}
				</div>

				{/* Amount badge */}
				{item.amount > 1 && (
					<Badge className="absolute left-1 top-1 h-4 border-0 bg-[var(--admin-surface)] px-1 text-[9px] text-[var(--admin-text)]">
						x{item.amount}
					</Badge>
				)}

				{/* Limited */}
				{isLimited && (
					<Badge className="absolute bottom-1 left-1 h-4 border-0 bg-[var(--admin-accent)] px-1 text-[8px] text-[var(--admin-accent-foreground)]">
						LTD {item.limitedSells}/{item.limitedStack}
					</Badge>
				)}
			</div>

			{/* Name + price */}
			<div className="border-t bg-background/95 px-2 py-1.5">
				<p className="truncate text-xs font-medium leading-tight">
					{item.catalogName || item.baseName || `#${item.id}`}
				</p>
				<div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono">
					{item.costCredits > 0 && (
						<span className="inline-flex items-center gap-0.5 text-[var(--admin-warning)] dark:text-[var(--admin-warning)]">
							<CurrencyIcon kind="credits" size={12} />
							{item.costCredits}
						</span>
					)}
					{item.costPoints > 0 && (
						<span
							className={`inline-flex items-center gap-0.5 ${points.color}`}
						>
							<CurrencyIcon
								kind={currencyKindFromPointsType(item.pointsType)}
								size={12}
							/>
							{item.costPoints}
						</span>
					)}
					{item.costCredits === 0 && item.costPoints === 0 && (
						<span className="text-muted-foreground">Free</span>
					)}
				</div>
			</div>
		</button>
	);
}

// ── Shop tile furni icon (resizable) ────────────────────────────

export function ShopFurniIcon({
	classname,
	revision,
	size,
}: {
	classname: string;
	revision: number;
	size: number;
}) {
	if (!classname) {
		return (
			<Package
				className="text-muted-foreground/40"
				style={{ width: size * 0.5, height: size * 0.5 }}
			/>
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
		<img
			src={primary}
			alt={classname}
			className="object-contain"
			style={{ imageRendering: "pixelated", maxWidth: size, maxHeight: size }}
			onError={handleError}
			loading="lazy"
		/>
	);
}
