"use client";

import { Folder, Home, Loader2, Plus, Search, Wand2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type CatalogKind, createAutoCategory } from "@/actions/catalog";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import { IconPicker } from "@/components/admin/catalog/icon-picker";
import { useCatalogManager } from "@/components/admin/catalog-manager/use-catalog-store";
import { CatalogIcon, LAYOUT_COLORS } from "@/components/admin/catalog-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	suggestCatalogIcon,
	suggestCatalogLayoutFromBaseItems,
	suggestCategoryName,
} from "@/features/catalog/domain/organize";
import { logger } from "@/lib/browser-log";
import { CATALOG_LAYOUTS, type CatalogLayout } from "@/lib/catalog-layouts";
import { getLocalIconUrl } from "@/lib/furni/classname";
import { cn } from "@/lib/utils";
import { LiveCatalogPreview } from "./live-catalog-preview";

interface FurniResult {
	id: number;
	itemName: string;
	publicName: string;
	type: string;
	spriteId: number;
	interactionType: string;
}

interface AutoCategoryDialogProps {
	catalogType: CatalogKind;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (pageId: number) => void;
}

export function AutoCategoryDialog({
	catalogType,
	open,
	onOpenChange,
	onCreated,
}: AutoCategoryDialogProps) {
	const { state } = useCatalogManager();
	const t = useTranslations("pages.admin.catalog.workspace.autoCategory");
	const { rootPages, selectedPageId } = state;

	const [mode, setMode] = useState<"empty" | "furni">("furni");

	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [results, setResults] = useState<FurniResult[]>([]);
	const [searchLoading, setSearchLoading] = useState(false);
	const [selected, setSelected] = useState<FurniResult[]>([]);
	const inputRef = useRef<HTMLInputElement>(null);

	const [parentId, setParentId] = useState<number>(-1);
	const [caption, setCaption] = useState("");
	const [iconImage, setIconImage] = useState(0);
	const [layout, setLayout] = useState<CatalogLayout>("default_3x3");
	const [enabled, setEnabled] = useState("1");
	const [visible, setVisible] = useState("1");
	const [isCreating, setIsCreating] = useState(false);

	const [captionTouched, setCaptionTouched] = useState(false);
	const [iconTouched, setIconTouched] = useState(false);
	const [layoutTouched, setLayoutTouched] = useState(false);

	const [freeMode, setFreeMode] = useState(true);
	const [credits, setCredits] = useState(0);
	const [points, setPoints] = useState(0);
	const [pointsType, setPointsType] = useState(0);

	// Default the parent to the currently selected page when the wizard opens.
	useEffect(() => {
		if (!open) return;
		setParentId(selectedPageId ?? -1);
	}, [open, selectedPageId]);

	const parentOptions = useMemo(() => {
		const options: Array<{ id: number; caption: string }> = [
			{ id: -1, caption: "Root" },
		];
		const selectedNode =
			selectedPageId != null ? state.nodes.get(selectedPageId) : undefined;
		if (selectedNode)
			options.push({ id: selectedNode.id, caption: selectedNode.caption });
		for (const p of rootPages) {
			if (!options.some((o) => o.id === p.id)) {
				options.push({ id: p.id, caption: p.caption });
			}
		}
		return options;
	}, [rootPages, selectedPageId, state.nodes]);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);

	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => inputRef.current?.focus(), 50);
		return () => clearTimeout(t);
	}, [open]);

	useEffect(() => {
		if (!open || mode !== "furni" || debounced.length < 2) {
			setResults([]);
			return;
		}
		setSearchLoading(true);
		const ac = new AbortController();
		fetch(
			`/cms_api/admin/furni/search?q=${encodeURIComponent(debounced)}&limit=40`,
			{
				signal: ac.signal,
			},
		)
			.then((r) => r.json())
			.then((data) => setResults(data.results ?? []))
			.catch((error) =>
				logger.error("[AutoCategory] furni search failed", {
					err: error as Error,
				}),
			)
			.finally(() => setSearchLoading(false));
		return () => ac.abort();
	}, [debounced, mode, open]);

	const sug = useMemo(() => {
		if (mode !== "furni" || selected.length === 0) return null;
		return {
			name: suggestCategoryName(selected),
			layout: suggestCatalogLayoutFromBaseItems(
				selected.map((f) => ({
					type: f.type,
					interactionType: f.interactionType,
				})),
			),
			icon: suggestCatalogIcon(selected),
		};
	}, [selected, mode]);

	useEffect(() => {
		if (!sug) return;
		if (!captionTouched && sug.name) setCaption(sug.name);
		if (!layoutTouched && sug.layout) setLayout(sug.layout.layout);
		if (!iconTouched && sug.icon > 0) setIconImage(sug.icon);
	}, [sug, captionTouched, layoutTouched, iconTouched]);

	const previewItems = useMemo<CatalogItemData[]>(() => {
		if (mode !== "furni" || selected.length === 0) return [];
		return selected.map((f, idx) => ({
			id: -1 - idx,
			catalogName: f.publicName || f.itemName,
			itemIds: String(f.id),
			costCredits: freeMode ? 0 : credits,
			costPoints: freeMode ? 0 : points,
			pointsType: freeMode ? 0 : pointsType,
			amount: 1,
			limitedSells: 0,
			limitedStack: 0,
			orderNumber: idx,
			offerId: -1,
			songId: 0,
			haveOffer: "1",
			clubOnly: "0",
			extradata: "",
			baseName: f.publicName || f.itemName,
			baseItemName: f.itemName,
			spriteId: f.spriteId,
			baseItem: {
				id: f.id,
				spriteId: f.spriteId,
				publicName: f.publicName || f.itemName,
				itemName: f.itemName,
				type: f.type,
				width: 1,
				length: 1,
				stackHeight: 0,
				allowStack: 1,
				allowSit: 0,
				allowLay: 0,
				allowWalk: 0,
				allowGift: 1,
				allowTrade: 1,
				allowRecycle: 0,
				allowMarketplaceSell: 0,
				allowInventoryStack: 1,
				interactionType: f.interactionType,
				interactionModesCount: 1,
				vendingIds: "0",
				customparams: "",
				effectIdMale: 0,
				effectIdFemale: 0,
				clothingOnWalk: "",
			},
		}));
	}, [selected, mode, freeMode, credits, points, pointsType]);

	const toggleFurni = useCallback((f: FurniResult) => {
		setSelected((prev) => {
			if (prev.some((x) => x.id === f.id)) {
				return prev.filter((x) => x.id !== f.id);
			}
			return [...prev, f];
		});
	}, []);

	const handleCreate = async () => {
		if (isCreating) return;
		if (!caption.trim()) {
			toast.error("Name is required");
			return;
		}
		if (mode === "furni" && selected.length === 0) {
			toast.error("Select at least one furni item");
			return;
		}
		setIsCreating(true);
		try {
			const offerRows =
				mode === "furni"
					? selected.map((f) => ({
							baseId: f.id,
							credits: freeMode ? 0 : credits,
							points: freeMode ? 0 : points,
							pointsType: freeMode ? 0 : pointsType,
						}))
					: [];
			const result = await createAutoCategory({
				kind: catalogType,
				parentId,
				caption: caption.trim(),
				pageLayout: layout,
				iconImage: iconImage,
				enabled: enabled as "0" | "1",
				visible: visible as "0" | "1",
				offerRows,
			});
			if (!result.ok) throw new Error(result.error ?? "Failed");
			const pageId = result.data?.pageId;
			if (pageId == null) throw new Error("No page id returned");
			toast.success(
				`Created "${caption.trim()}" with ${offerRows.length} items`,
			);
			onCreated(pageId);
			resetState();
			onOpenChange(false);
		} catch (error) {
			logger.error("[AutoCategory] create failed", {
				err: error as Error,
			});
			toast.error("Failed to create category");
		} finally {
			setIsCreating(false);
		}
	};

	const resetState = () => {
		setMode("furni");
		setQuery("");
		setDebounced("");
		setSelected([]);
		setCaption("");
		setIconImage(0);
		setLayout("default_3x3");
		setEnabled("1");
		setVisible("1");
		setCaptionTouched(false);
		setIconTouched(false);
		setLayoutTouched(false);
		setFreeMode(true);
		setCredits(0);
		setPoints(0);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden p-0">
				<DialogHeader className="flex-none border-b px-4 py-3">
					<DialogTitle className="flex items-center gap-2 text-sm font-semibold">
						<Wand2 className="h-4 w-4" />
						{t("title")}
						{selected.length > 0 && (
							<Badge variant="secondary" className="text-[10px]">
								{t("itemsBadge", { count: selected.length })}
							</Badge>
						)}
					</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 overflow-hidden">
					{/* Left: form */}
					<div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
						{/* Mode */}
						<div className="flex gap-1">
							<Button
								type="button"
								variant={mode === "furni" ? "default" : "outline"}
								size="sm"
								className="h-7 text-xs"
								onClick={() => setMode("furni")}
							>
								{t("fromFurni")}
							</Button>
							<Button
								type="button"
								variant={mode === "empty" ? "default" : "outline"}
								size="sm"
								className="h-7 text-xs"
								onClick={() => {
									setMode("empty");
									setSelected([]);
								}}
							>
								{t("emptyPage")}
							</Button>
						</div>

						{/* Furni search + picker */}
						{mode === "furni" && (
							<div className="space-y-3 rounded-md border bg-[var(--admin-surface)] p-3">
								<div className="relative">
									<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										ref={inputRef}
										placeholder={t("searchPlaceholder")}
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										className="h-8 pl-9 text-xs"
									/>
									{searchLoading && (
										<Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
									)}
								</div>

								{debounced.length >= 2 && (
									<div className="max-h-[140px] divide-y overflow-y-auto rounded border">
										{results.length === 0 && !searchLoading ? (
											<p className="py-4 text-center text-xs text-muted-foreground">
												{t("noResults")}
											</p>
										) : (
											results.map((r) => {
												const isSelected = selected.some((x) => x.id === r.id);
												return (
													<button
														key={r.id}
														type="button"
														onClick={() => toggleFurni(r)}
														className={cn(
															"flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent",
															isSelected && "bg-accent",
														)}
													>
														<FurniThumb item={r} />
														<div className="min-w-0 flex-1">
															<p className="truncate text-xs font-medium">
																{r.publicName || (
																	<span className="italic text-muted-foreground">
																		{r.itemName}
																	</span>
																)}
															</p>
															<p className="truncate font-mono text-[10px] text-muted-foreground">
																#{r.id} · {r.type} · {r.interactionType}
															</p>
														</div>
														{isSelected && (
															<Badge
																variant="secondary"
																className="h-4 text-[9px]"
															>
																{t("added")}
															</Badge>
														)}
													</button>
												);
											})
										)}
									</div>
								)}

								{selected.length > 0 && (
									<div className="flex max-h-[80px] flex-wrap gap-1 overflow-y-auto">
										{selected.map((f) => (
											<button
												key={f.id}
												type="button"
												onClick={() => toggleFurni(f)}
												className="group flex items-center gap-1 rounded bg-[var(--admin-accent-subtle)] px-1.5 py-0.5 text-[10px]"
											>
												<FurniThumb item={f} size={14} />
												{f.publicName || f.itemName}
												<X className="h-2.5 w-2.5 text-muted-foreground group-hover:text-destructive" />
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* Price */}
						{mode === "furni" && (
							<div className="space-y-2 rounded-md border bg-[var(--admin-surface)] p-3">
								<div className="flex items-center gap-2 text-xs font-medium text-[var(--admin-text-muted)]">
									{t("price")}
									<Button
										type="button"
										variant={freeMode ? "default" : "outline"}
										size="sm"
										className="h-6 px-2 text-[10px]"
										onClick={() => setFreeMode(true)}
									>
										{t("free")}
									</Button>
									<Button
										type="button"
										variant={!freeMode ? "default" : "outline"}
										size="sm"
										className="h-6 px-2 text-[10px]"
										onClick={() => setFreeMode(false)}
									>
										{t("setPrice")}
									</Button>
								</div>
								{!freeMode && (
									<div className="flex gap-2 text-xs">
										<label className="flex items-center gap-1 text-[10px] text-muted-foreground">
											{t("credits")}
											<input
												type="number"
												className="w-16 rounded border bg-[var(--admin-canvas)] px-1.5 py-1 text-xs"
												value={credits}
												onChange={(e) => setCredits(Number(e.target.value))}
												min={0}
											/>
										</label>
										<label className="flex items-center gap-1 text-[10px] text-muted-foreground">
											{t("points")}
											<input
												type="number"
												className="w-16 rounded border bg-[var(--admin-canvas)] px-1.5 py-1 text-xs"
												value={points}
												onChange={(e) => setPoints(Number(e.target.value))}
												min={0}
											/>
										</label>
										<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
											{t("pointsType")}
											<Select
												value={String(pointsType)}
												onValueChange={(v) => setPointsType(Number(v))}
											>
												<SelectTrigger className="h-7 w-24 text-[10px]">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="0" className="text-xs">
														Duckets
													</SelectItem>
													<SelectItem value="5" className="text-xs">
														Diamonds
													</SelectItem>
												</SelectContent>
											</Select>
										</span>
									</div>
								)}
							</div>
						)}

						{/* Parent + settings */}
						<div className="space-y-3 rounded-md border bg-[var(--admin-surface)] p-3">
							<div className="flex flex-col gap-1 text-xs font-medium text-[var(--admin-text-muted)]">
								{t("parent")}
								<Select
									value={String(parentId)}
									onValueChange={(v) => setParentId(Number(v))}
								>
									<SelectTrigger className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{parentOptions.map((p) => (
											<SelectItem
												key={p.id}
												value={String(p.id)}
												className="text-xs"
											>
												<span className="flex items-center gap-1.5">
													{p.id === -1 ? (
														<Home className="h-3 w-3 shrink-0" />
													) : (
														<Folder className="h-3 w-3 shrink-0" />
													)}
													{p.id === -1 ? t("root") : p.caption}
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="flex flex-col gap-1 text-xs font-medium text-[var(--admin-text-muted)]">
								{t("caption")}
								<div className="flex gap-1">
									<Input
										className="h-8 text-xs"
										value={caption}
										onChange={(e) => {
											setCaption(e.target.value);
											setCaptionTouched(true);
										}}
										placeholder={t("captionPlaceholder")}
									/>
									{sug?.name && caption !== sug.name && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-8 shrink-0 px-2 text-[10px]"
											onClick={() => {
												setCaption(sug.name ?? "");
												setCaptionTouched(false);
											}}
										>
											{sug.name}
										</Button>
									)}
								</div>
							</div>

							<div className="flex flex-col gap-1 text-xs font-medium text-[var(--admin-text-muted)]">
								{t("icon")}
								<div className="flex items-center gap-1.5">
									<IconPicker
										value={iconImage}
										onChange={(id) => {
											setIconImage(id);
											setIconTouched(true);
										}}
									>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-8 gap-1.5 px-2"
										>
											<CatalogIcon iconImage={iconImage} size={18} />
											<span className="font-mono text-[10px] text-muted-foreground">
												{iconImage > 0 ? `#${iconImage}` : t("pickIcon")}
											</span>
										</Button>
									</IconPicker>
									{sug && sug.icon > 0 && iconImage !== sug.icon && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-8 px-2 text-[10px]"
											onClick={() => {
												setIconImage(sug.icon);
												setIconTouched(false);
											}}
										>
											<Wand2 className="mr-0.5 h-2.5 w-2.5" />
											{sug.icon}
										</Button>
									)}
								</div>
							</div>

							<div className="flex flex-col gap-1 text-xs font-medium text-[var(--admin-text-muted)]">
								{t("layout")}
								<div className="flex flex-wrap gap-1">
									{CATALOG_LAYOUTS.map((l) => {
										const color =
											LAYOUT_COLORS[l] || "bg-muted text-muted-foreground";
										return (
											<button
												key={l}
												type="button"
												onClick={() => {
													setLayout(l);
													setLayoutTouched(true);
												}}
												className={cn(
													"rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
													layout === l
														? cn(color, "border-current ring-1 ring-current/20")
														: "border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text-muted)] hover:border-current",
												)}
											>
												{l.replace("default_3x3", "3x3")}
											</button>
										);
									})}
								</div>
								{sug?.layout && layout !== sug.layout.layout && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-6 w-fit border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-2 text-[10px] text-[var(--admin-warning)]"
										onClick={() => {
											setLayout(sug.layout ? sug.layout.layout : layout);
											setLayoutTouched(false);
										}}
									>
										<Wand2 className="mr-0.5 h-2.5 w-2.5" />
										{t("suggestedLayout", { layout: sug.layout.layout })}
									</Button>
								)}
							</div>

							<div className="flex gap-2">
								<label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
									<input
										type="checkbox"
										checked={enabled === "1"}
										onChange={(e) => setEnabled(e.target.checked ? "1" : "0")}
									/>
									{t("enabled")}
								</label>
								<label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
									<input
										type="checkbox"
										checked={visible === "1"}
										onChange={(e) => setVisible(e.target.checked ? "1" : "0")}
									/>
									{t("visible")}
								</label>
							</div>
						</div>
					</div>

					{/* Right: live preview */}
					<div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l">
						<LiveCatalogPreview
							form={{
								caption,
								pageLayout: layout,
								iconImage,
								enabled,
								visible,
							}}
							items={previewItems}
							loadingItems={false}
							onApplyLayout={(l) => setLayout(l as CatalogLayout)}
						/>
					</div>
				</div>

				<div className="flex flex-none justify-end gap-2 border-t px-4 py-2.5">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
					>
						{t("cancel")}
					</Button>
					<Button
						type="button"
						size="sm"
						className="gap-1"
						disabled={isCreating || !caption.trim()}
						onClick={() => void handleCreate()}
					>
						{isCreating ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<Plus className="h-3 w-3" />
						)}
						{selected.length > 0
							? t("createWithItems", { count: selected.length })
							: t("create")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function FurniThumb({
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
