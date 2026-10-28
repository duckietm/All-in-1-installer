"use client";

import {
	AlertTriangle,
	Eye,
	EyeOff,
	Loader2,
	MonitorPlay,
	PackageX,
	Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import {
	getShopGridClass,
	getShopTileSize,
	parseFirstItemId,
	ShopTile,
} from "@/components/admin/catalog/shop-tile";
import { ImagePreview } from "@/components/admin/catalog-manager/image-preview";
import { CatalogIcon, LAYOUT_COLORS } from "@/components/admin/catalog-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { suggestCatalogLayout } from "@/features/catalog/domain/organize";
import { cn } from "@/lib/utils";

interface LivePageForm {
	caption?: string | number | null;
	pageLayout?: string | number | null;
	pageHeadline?: string | number | null;
	pageTeaser?: string | number | null;
	pageText1?: string | number | null;
	pageText2?: string | number | null;
	pageTextDetails?: string | number | null;
	pageSpecial?: string | number | null;
	pageTextTeaser?: string | number | null;
	iconImage?: string | number | null;
	enabled?: string | number | null;
	visible?: string | number | null;
}

interface LiveCatalogPreviewProps {
	form: LivePageForm;
	items?: CatalogItemData[] | null;
	furniRevisionMap?: Record<number, { classname: string; revision: number }>;
	loadingItems?: boolean;
	className?: string;
	onApplyLayout?: (layout: string) => void;
}

/**
 * Always-live shop preview of a catalog page: reflects the current editor
 * form state (title, layout, images, texts) plus the page's offers so the
 * staff member sees exactly how the page is organized for players.
 */
export function LiveCatalogPreview({
	form,
	items = [],
	furniRevisionMap = {},
	loadingItems,
	className,
	onApplyLayout,
}: LiveCatalogPreviewProps) {
	const t = useTranslations("pages.admin.catalog.workspace.preview");
	const layout = String(form.pageLayout || "default_3x3");
	const caption = String(form.caption || "");
	const isEnabled = String(form.enabled ?? "1") === "1";
	const isVisible = String(form.visible ?? "1") === "1";

	const itemsList = items ?? [];
	const suggestion =
		itemsList.length > 0 ? suggestCatalogLayout(itemsList) : null;
	const showSuggestion =
		suggestion !== null && suggestion.layout !== layout && onApplyLayout;

	const gridClass = cn(
		"grid gap-2",
		layout === "frontpage" ||
			layout === "single_bundle" ||
			layout === "room_bundle"
			? "grid-cols-1"
			: getShopGridClass(layout).includes("grid-cols-1")
				? "grid-cols-1"
				: "grid-cols-2",
	);
	const tileSize = Math.min(getShopTileSize(layout), 88);

	return (
		<aside
			aria-label={t("label")}
			className={cn(
				"flex min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text)]",
				className,
			)}
		>
			{/* Panel header */}
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
				<div className="flex items-center gap-1.5 text-xs font-semibold">
					<MonitorPlay className="h-3.5 w-3.5" />
					{t("title")}
				</div>
				<div className="flex items-center gap-1">
					<PreviewStatusDot on={isEnabled}>
						{t(isEnabled ? "on" : "off")}
					</PreviewStatusDot>
					<PreviewStatusDot on={isVisible}>
						{isVisible ? (
							<Eye className="h-2.5 w-2.5" />
						) : (
							<EyeOff className="h-2.5 w-2.5" />
						)}
					</PreviewStatusDot>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{/* Auto-organize hints */}
				{showSuggestion && suggestion && (
					<div className="mb-3 flex items-start gap-2 rounded-md border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] p-2 text-[11px] text-[var(--admin-warning)]">
						<Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div className="min-w-0 flex-1">
							<p className="font-medium">{t("suggestedLayout")}</p>
							<p className="break-words text-[var(--admin-text-muted)]">
								{t("suggestedLayoutReason", {
									layout: suggestion.layout,
									reason: suggestion.reason,
								})}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-1.5 h-6 text-[11px] px-2"
								onClick={() => onApplyLayout(suggestion.layout)}
							>
								{t("applyLayout")}
							</Button>
						</div>
					</div>
				)}

				{!isEnabled && (
					<div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] p-2 text-[11px] text-[var(--admin-warning)]">
						<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
						{t("disabledHint")}
					</div>
				)}

				{/* Game-catalog window */}
				<div className="overflow-hidden rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] shadow-sm">
					{/* Window title bar */}
					<div className="flex items-center gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-2.5 py-1.5">
						<CatalogIcon iconImage={Number(form.iconImage) || 0} size={16} />
						<span className="min-w-0 flex-1 truncate text-xs font-semibold">
							{caption || t("untitled")}
						</span>
						<Badge
							className={cn(
								"h-4 border-0 px-1 font-mono text-[8px]",
								LAYOUT_COLORS[layout] || "bg-muted text-muted-foreground",
							)}
						>
							{layout.replace("default_3x3", "3x3")}
						</Badge>
					</div>

					{/* Main body */}
					<div
						className="p-2.5"
						style={{
							backgroundColor:
								"var(--admin-surface-muted, var(--admin-canvas))",
						}}
					>
						{/* Headline banner */}
						{String(form.pageHeadline || "") && (
							<div className="mb-2">
								<ImagePreview
									value={String(form.pageHeadline)}
									height={56}
									className="w-full rounded"
								/>
							</div>
						)}

						{/* Teaser row */}
						{String(form.pageTeaser || "") && (
							<div className="mb-2">
								<ImagePreview
									value={String(form.pageTeaser)}
									height={48}
									className="w-full rounded"
								/>
							</div>
						)}

						{/* Text blocks */}
						{String(form.pageText1 || "") && (
							<p className="mb-1 text-[11px] leading-snug break-words" key="p1">
								{String(form.pageText1)}
							</p>
						)}
						{String(form.pageText2 || "") && (
							<p
								className="mb-1 text-[11px] text-[var(--admin-text-muted)] leading-snug break-words"
								key="p2"
							>
								{String(form.pageText2)}
							</p>
						)}
						{String(form.pageTextDetails || "") && (
							<p
								className="mb-2 text-[10px] text-[var(--admin-text-muted)] break-words"
								key="pd"
							>
								{String(form.pageTextDetails)}
							</p>
						)}

						{/* Offers */}
						{loadingItems && !items ? (
							<div className="flex items-center justify-center py-10">
								<Loader2 className="h-5 w-5 animate-spin text-[var(--admin-text-muted)]" />
							</div>
						) : itemsList.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-[var(--admin-border)] py-8 text-center">
								<PackageX className="h-7 w-7 text-[var(--admin-text-muted)]/40" />
								<p className="mt-1.5 text-[11px] text-[var(--admin-text-muted)]">
									{t("noItems")}
								</p>
							</div>
						) : (
							<>
								<div className={gridClass}>
									{itemsList.map((item) => {
										const firstId = parseFirstItemId(item.itemIds);
										const furni =
											firstId != null ? furniRevisionMap[firstId] : undefined;
										return (
											<ShopTile
												key={item.id}
												item={item}
												furni={furni}
												iconHeight={tileSize}
											/>
										);
									})}
								</div>
								<p className="mt-2 text-center text-[10px] text-[var(--admin-text-muted)]">
									{itemsList.length} {t("items")}
								</p>
							</>
						)}
					</div>
				</div>
			</div>
		</aside>
	);
}

function PreviewStatusDot({
	on,
	children,
}: {
	on: boolean;
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none",
				on
					? "bg-[var(--admin-success-subtle)] text-[var(--admin-success)]"
					: "bg-[var(--admin-error-subtle)] text-[var(--admin-error)]",
			)}
		>
			{children}
		</span>
	);
}
