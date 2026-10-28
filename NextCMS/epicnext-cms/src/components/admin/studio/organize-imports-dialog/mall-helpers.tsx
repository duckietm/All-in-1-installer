"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { GripVertical, LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { CatalogLayout } from "@/lib/catalog-layouts";
import { getLocalIconUrl } from "@/lib/furni/classname";
import { cn } from "@/lib/utils";
export interface OrganizeImportItem {
	itemId: number;
	catalogItemId: number | null;
	alreadyPlaced: boolean;
	itemName: string;
	publicName: string;
	spriteId: number;
	type: string;
	interactionType: string;
	sourcePageCaption: string | null;
}

export interface OrganizeImportGroup {
	name: string;
	icon: number;
	layout: CatalogLayout | null;
	total: number;
	moved: number;
	added: number;
	items: OrganizeImportItem[];
}

export const LAYOUT_GRIDS: Record<string, { cols: number; rows: number }> = {
	default_3x3: { cols: 3, rows: 3 },
	sold_ltd_items: { cols: 3, rows: 3 },
	room_bundle: { cols: 3, rows: 2 },
	badge_display: { cols: 3, rows: 3 },
	spaces_new: { cols: 4, rows: 2 },
	single_bundle: { cols: 1, rows: 1 },
};

export function FurniThumb({
	item,
	size = 24,
}: {
	item: { itemName: string };
	size?: number;
}) {
	const primary = getLocalIconUrl(item.itemName);
	return (
		<div
			className="flex items-center justify-center rounded bg-muted/50"
			style={{ width: size, height: size }}
		>
			<img
				src={primary}
				alt={item.itemName}
				className="max-h-full max-w-full object-contain"
				style={{ imageRendering: "pixelated" }}
				onError={(e) => {
					const img = e.target as HTMLImageElement;
					img.style.opacity = "0";
				}}
				loading="lazy"
			/>
		</div>
	);
}

/** Schematic grid of how a layout places the first furniture items. */
export function LayoutPreview({
	layout,
	items,
	compact = false,
}: {
	layout: string;
	items: OrganizeImportItem[];
	compact?: boolean;
}) {
	const grid = LAYOUT_GRIDS[layout];
	if (!grid) {
		return (
			<div
				className={cn(
					"flex items-center justify-center gap-1.5 rounded border border-dashed border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[10px] text-muted-foreground",
					compact ? "h-12 w-24" : "h-20 w-40",
				)}
			>
				<LayoutGrid className="h-3.5 w-3.5" />
				<span className="truncate">{layout}</span>
			</div>
		);
	}
	const cells = grid.cols * grid.rows;
	return (
		<div
			className="grid gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-1.5"
			style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}
		>
			{Array.from({ length: cells }).map((_, index) => {
				const item = items[index];
				return item ? (
					<div
						key={item.itemId}
						className="flex items-center justify-center rounded bg-[var(--admin-surface)]"
						style={{ width: compact ? 22 : 36, height: compact ? 22 : 36 }}
						title={item.publicName || item.itemName}
					>
						<FurniThumb
							item={{ itemName: item.itemName }}
							size={compact ? 16 : 26}
						/>
					</div>
				) : (
					<div
						key={`empty-${index}`}
						className="rounded bg-muted/40"
						style={{ width: compact ? 22 : 36, height: compact ? 22 : 36 }}
					/>
				);
			})}
		</div>
	);
}

interface GroupItemListProps {
	items: OrganizeImportItem[];
	moveTargets: OrganizeImportGroup[];
	selection: Set<number>;
	destDupes: Set<string>;
	onToggleSelect: (itemId: number, checked: boolean) => void;
	onMoveItem: (item: OrganizeImportItem, toName: string) => void;
	onDragStart: (item: OrganizeImportItem) => void;
	onDragEnd: (item: OrganizeImportItem) => void;
}

// Virtualized row list, scrolled inside its own container so groups with
// hundreds of furniture items stay smooth.
export function GroupItemList({
	items,
	moveTargets,
	selection,
	destDupes,
	onToggleSelect,
	onMoveItem,
	onDragStart,
	onDragEnd,
}: GroupItemListProps) {
	const t = useTranslations("pages.admin.catalog.workspace.organizeImports");
	const scrollRef = useRef<HTMLDivElement>(null);

	const rowVirtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 34,
		overscan: 14,
	});

	return (
		<div
			ref={scrollRef}
			className={cn(
				"overflow-y-auto rounded border border-[var(--admin-border)] bg-[var(--admin-canvas)]",
				items.length > 8 ? "max-h-64" : "max-h-none",
			)}
			style={{ height: items.length > 8 ? undefined : "auto" }}
		>
			{items.length === 0 ? (
				<p className="px-2 py-2 text-[10px] text-muted-foreground">
					{t("emptyCategory")}
				</p>
			) : (
				<div
					style={{
						height: rowVirtualizer.getTotalSize(),
						position: "relative",
					}}
				>
					{rowVirtualizer.getVirtualItems().map((vItem) => {
						const item = items[vItem.index];
						const checked = selection.has(item.itemId);
						const isDupe = destDupes.has(item.itemName);
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: draggable row with native HTML5 DnD
							<div
								key={item.itemId}
								className="absolute left-0 right-0 flex items-center gap-2 border-b border-[var(--admin-border)]/50 px-2 hover:bg-[var(--admin-surface-elevated)]"
								style={{ top: vItem.start, height: vItem.size }}
								draggable
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = "move";
									e.dataTransfer.setData("text/plain", String(item.itemId));
									onDragStart(item);
								}}
								onDragEnd={() => onDragEnd(item)}
							>
								<GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
								<input
									type="checkbox"
									checked={checked}
									onChange={(e) =>
										onToggleSelect(item.itemId, e.target.checked)
									}
								/>
								<FurniThumb item={{ itemName: item.itemName }} size={26} />
								<div className="min-w-0 flex-1 truncate">
									<p className="truncate text-xs font-medium text-[var(--admin-text)]">
										{item.publicName || item.itemName}
									</p>
									<p className="truncate font-mono text-[9px] text-muted-foreground">
										{item.itemName}
									</p>
								</div>
								{item.alreadyPlaced ? (
									<span className="shrink-0 rounded bg-[var(--admin-success-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--admin-text)]">
										{item.sourcePageCaption
											? item.sourcePageCaption.replace(
													new RegExp(`^${t("impPrefix")}`),
													"",
												)
											: t("isMoved")}
									</span>
								) : (
									<span className="shrink-0 rounded bg-[var(--admin-info-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--admin-text)]">
										{t("isNew")}
									</span>
								)}
								{isDupe && (
									<span
										title={t("dupeOnDest")}
										className="shrink-0 rounded bg-[var(--admin-warning-subtle)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--admin-warning)]"
									>
										{t("dupeOnDestShort")}
									</span>
								)}
								{moveTargets.length > 0 && (
									<select
										title={t("moveItemTo")}
										value=""
										onChange={(e) => {
											onMoveItem(item, e.target.value);
											e.target.value = "";
										}}
										className="h-6 shrink-0 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-1 text-[9px] text-[var(--admin-text)]"
									>
										<option value="" disabled>
											{t("moveItemTo")}
										</option>
										{moveTargets.map((g) => (
											<option key={g.name} value={g.name}>
												{g.name}
											</option>
										))}
									</select>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
