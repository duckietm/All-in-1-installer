"use client";

import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Languages,
	Loader2,
	MonitorPlay,
	Package,
	Save,
	Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { updateCatalogPage } from "@/actions/catalog";
import { updateBcPage } from "@/actions/catalog-bc";
import { BulkImportItems } from "@/components/admin/catalog/bulk-import-items";
import { CatalogImagePicker } from "@/components/admin/catalog/catalog-image-picker";
import {
	type CatalogItemData,
	CatalogItemsTable,
} from "@/components/admin/catalog/catalog-items-table";
import { CatalogTranslateTab } from "@/components/admin/catalog/catalog-translate-tab";
import { IconPicker } from "@/components/admin/catalog/icon-picker";
import { QuickAddFurni } from "@/components/admin/catalog/quick-add-furni";
import { AutoOrganize } from "@/components/admin/catalog-manager/auto-organize";
import { BcItemsEditor } from "@/components/admin/catalog-manager/bc-items-editor";
import { LiveCatalogPreview } from "@/components/admin/catalog-manager/live-catalog-preview";
import { CatalogIcon, LAYOUT_COLORS } from "@/components/admin/catalog-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLatestRequest } from "@/features/catalog/client/use-latest-request";
import {
	CATALOG_LAYOUTS,
	type CatalogLayout,
	LAYOUT_DESCRIPTIONS,
} from "@/lib/catalog-layouts";
import { cn } from "@/lib/utils";
import styles from "./catalog-access.module.css";
import { ImagePreview } from "./image-preview";
import { catalogTreeQs, useCatalogManager } from "./use-catalog-store";

interface PageDetail {
	id: number;
	caption: string;
	parentId: number;
	pageLayout: string;
	enabled: string;
	visible: string;
	minRank: number;
	clubOnly: string;
	orderNum: number;
	iconImage: number;
	iconColor: number;
	pageHeadline: string;
	pageTeaser: string;
	pageSpecial: string | null;
	pageText1: string | null;
	pageText2: string | null;
	pageTextDetails: string | null;
	pageTextTeaser: string | null;
	itemCount?: number;
}

interface ItemsData {
	items: CatalogItemData[];
	baseItems: {
		id: number;
		publicName: string;
		itemName: string;
		spriteId: number;
		type: string;
	}[];
	catalogNameMap: Record<number, string>;
	furniDataIdList: number[];
	furniDescriptionMap: Record<number, string>;
	furniRevisionMap: Record<number, { classname: string; revision: number }>;
	interactionTypes: string[];
	allPages: { id: number; caption: string }[];
	gamedataHotel?: string;
}

export interface PageUpdateData {
	id: number;
	caption: string;
	enabled: string;
	visible: string;
	pageLayout: string;
	iconImage: number;
}

interface InlineEditorProps {
	initialOfferId?: number | null;
	pageId: number | null;
	onSaved: (updated: PageUpdateData) => void;
}

type FormState = Record<string, string | number | null>;

export function InlineEditor(props: InlineEditorProps) {
	const { catalogType } = useCatalogManager();
	return (
		<InlineEditorSession key={`${catalogType}:${props.pageId}`} {...props} />
	);
}

function InlineEditorSession({
	pageId,
	onSaved,
	initialOfferId,
}: InlineEditorProps) {
	const pageRequests = useLatestRequest();
	const itemRequests = useLatestRequest();
	const saveRequests = useLatestRequest();
	const tActions = useTranslations("pages.admin.actions");
	const tNavigation = useTranslations("pages.admin.navigation");
	const t = useTranslations("pages.admin.catalog.workspace");
	const [offersDirty, setOffersDirty] = useState(false);
	const { dispatch, catalogType, canEdit } = useCatalogManager();
	const catQs = catalogTreeQs(catalogType);
	const [page, setPage] = useState<PageDetail | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);
	const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (savedTimer.current) clearTimeout(savedTimer.current);
		},
		[],
	);
	const [form, setForm] = useState<FormState>({});
	const [original, setOriginal] = useState<FormState>({});
	const [showTexts, setShowTexts] = useState(false);
	const [activeTab, setActiveTab] = useState(
		initialOfferId ? "items" : "settings",
	);
	const [showPreview, setShowPreview] = useState(catalogType === "normal");

	// Items/translate data (lazy loaded)
	const [itemsData, setItemsData] = useState<ItemsData | null>(null);
	const [itemsLoading, setItemsLoading] = useState(false);
	const [itemsLoaded, setItemsLoaded] = useState(false);
	const [itemsError, setItemsError] = useState(false);

	// ── Dirty tracking ──────────────────────────────────────────
	const isDirty = useMemo(() => {
		return Object.keys(form).some((k) => form[k] !== original[k]);
	}, [form, original]);

	useEffect(() => {
		dispatch({ type: "SET_DIRTY", dirty: isDirty || offersDirty });
	}, [isDirty, offersDirty, dispatch]);

	// ── Ctrl+S handler ──────────────────────────────────────────
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				if (canEdit && isDirty && !saving && page) handleSave();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
		// biome-ignore lint/correctness/useExhaustiveDependencies: handleSave is a function declaration, so its identity changes every render; depending on it would re-register this listener on every keystroke. Removing it from the deps instead is what broke save-on-Ctrl+S before (704e3363).
	}, [canEdit, isDirty, saving, page, handleSave]);

	const loadPage = useCallback(
		async (id: number) => {
			const request = pageRequests.start();
			setLoading(true);
			try {
				const res = await fetch(
					`/cms_api/admin/catalog/tree?pageId=${id}${catQs}`,
					{ signal: request.signal },
				);
				if (!res.ok) throw new Error();
				const data = await res.json();
				if (!request.isCurrent()) return;
				const p = data.page as PageDetail;
				setPage(p);
				const formData: FormState = {
					caption: p.caption,
					pageLayout: p.pageLayout,
					enabled: String(p.enabled),
					visible: String(p.visible),
					...(catalogType === "normal"
						? { minRank: p.minRank ?? 0, clubOnly: String(p.clubOnly ?? "0") }
						: {}),
					orderNum: p.orderNum,
					iconImage: p.iconImage,
					iconColor: p.iconColor,
					pageHeadline: p.pageHeadline || "",
					pageTeaser: p.pageTeaser || "",
					pageSpecial: p.pageSpecial || "",
					pageText1: p.pageText1 || "",
					pageText2: p.pageText2 || "",
					pageTextDetails: p.pageTextDetails || "",
					pageTextTeaser: p.pageTextTeaser || "",
				};
				setForm(formData);
				setOriginal(formData);
			} catch {
				if (!request.isCurrent()) return;
				toast.error("Failed to load page");
				setPage(null);
			} finally {
				if (request.isCurrent()) setLoading(false);
			}
		},
		[catQs, catalogType, pageRequests],
	);

	const loadItemsData = useCallback(
		async (id: number) => {
			const request = itemRequests.start();
			setItemsError(false);
			setItemsLoading(true);
			try {
				const res = await fetch(
					`/cms_api/admin/catalog/items?pageId=${id}${catQs}`,
					{ signal: request.signal },
				);
				if (!res.ok) throw new Error();
				const data = await res.json();
				if (!request.isCurrent()) return;
				setItemsData(data as ItemsData);
				setItemsLoaded(true);
			} catch {
				if (!request.isCurrent()) return;
				setItemsLoaded(true);
				setItemsError(true);
				toast.error("Failed to load items");
			} finally {
				if (request.isCurrent()) setItemsLoading(false);
			}
		},
		// `catQs` selects which catalog the offers come from, so it has to be part
		// of this callback's identity: without it a switch keeps reading the
		// previous catalog's rows.
		[itemRequests, catQs],
	);

	const reloadItems = useCallback(() => {
		if (pageId && pageId > 0) loadItemsData(pageId);
	}, [pageId, loadItemsData]);

	useEffect(() => {
		if (pageId && pageId > 0) {
			loadPage(pageId);
			setItemsData(null);
			setItemsLoaded(false);
			setActiveTab(initialOfferId ? "items" : "settings");
			setShowPreview(false);
		} else {
			setPage(null);
			setForm({});
			setOriginal({});
			setItemsData(null);
			setItemsLoaded(false);
		}
	}, [pageId, loadPage, initialOfferId]);

	// Lazy-load items (shop catalog only — BC items live on the detail page).
	// Also eager-loads while the live preview panel is open so the preview
	// always reflects the page's offers.
	useEffect(() => {
		if (catalogType === "bc") return;
		if (
			(activeTab === "items" || activeTab === "translate" || showPreview) &&
			!itemsLoaded &&
			!itemsLoading &&
			pageId &&
			pageId > 0
		) {
			loadItemsData(pageId);
		}
	}, [
		activeTab,
		itemsLoaded,
		itemsLoading,
		pageId,
		loadItemsData,
		catalogType,
		showPreview,
	]);

	function update(key: string, value: string | number | null) {
		if (!canEdit) return;
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	async function handleSave() {
		if (!page || !canEdit || saving) return;
		const request = saveRequests.start();
		setSaving(true);
		try {
			const result =
				catalogType === "bc"
					? await updateBcPage({ id: page.id, ...form, expected: original })
					: await updateCatalogPage({
							id: page.id,
							...form,
							expected: original,
						});
			if (!request.isCurrent()) return;
			if (!result.ok) throw new Error(result.error || "Failed to save");
			toast.success(tActions("saved"));
			setJustSaved(true);
			if (savedTimer.current) clearTimeout(savedTimer.current);
			savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
			setOriginal({ ...form });
			setPage((prev) =>
				prev
					? {
							...prev,
							caption: String(form.caption || prev.caption),
							enabled: String(form.enabled ?? prev.enabled),
							visible: String(form.visible ?? prev.visible),
							pageLayout: String(form.pageLayout || prev.pageLayout),
							iconImage: (form.iconImage as number) ?? prev.iconImage,
						}
					: prev,
			);
			onSaved({
				id: page.id,
				caption: String(form.caption || page.caption),
				enabled: String(form.enabled ?? page.enabled),
				visible: String(form.visible ?? page.visible),
				pageLayout: String(form.pageLayout || page.pageLayout),
				iconImage: (form.iconImage as number) ?? page.iconImage,
			});
		} catch (e) {
			if (request.isCurrent())
				toast.error(e instanceof Error ? e.message : "Failed to save");
		} finally {
			if (request.isCurrent()) setSaving(false);
		}
	}

	if (!pageId || pageId <= 0) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
				Select a page from the tree to edit
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!page)
		return (
			<div className="flex flex-1 items-center justify-center">
				<Button variant="outline" onClick={() => loadPage(pageId)}>
					{t("retryPage")}
				</Button>
			</div>
		);

	const layoutColor =
		LAYOUT_COLORS[String(form.pageLayout)] || "bg-muted text-muted-foreground";

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b shrink-0">
				<div className="flex items-center gap-2">
					<CatalogIcon
						iconImage={(form.iconImage as number) ?? page.iconImage}
						size={24}
					/>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-sm font-semibold">
								{(form.caption as string) || page.caption}
							</h3>
							<Badge
								className={cn(
									"h-4 px-1 text-[8px] font-mono border-0",
									layoutColor,
								)}
							>
								{form.pageLayout as string}
							</Badge>
							{saving ? (
								<Badge
									variant="outline"
									className="h-4 px-1.5 text-[9px] text-[var(--admin-info)] border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)]"
								>
									<Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
									{tActions("saving")}
								</Badge>
							) : justSaved && !isDirty && !offersDirty ? (
								<Badge
									variant="outline"
									className="h-4 px-1.5 text-[9px] text-[var(--admin-success)] border-[var(--admin-success-border)] bg-[var(--admin-success-subtle)]"
								>
									<Check className="h-2.5 w-2.5 mr-0.5" />
									{tActions("saved")}
								</Badge>
							) : (
								(isDirty || offersDirty) && (
									<Badge
										variant="outline"
										className="h-4 px-1.5 text-[9px] text-[var(--admin-warning)] border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)]"
									>
										<AlertCircle className="h-2.5 w-2.5 mr-0.5" />
										{t("unsaved")}
									</Badge>
								)
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							#{page.id} &middot; Parent:{" "}
							{page.parentId === -1 ? "Root" : `#${page.parentId}`}
							{page.itemCount !== undefined && ` · ${page.itemCount} items`}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-1">
					{catalogType === "normal" && (
						<Button
							variant="ghost"
							size="sm"
							className={cn(
								"h-7 gap-1 text-xs",
								showPreview &&
									"border border-[var(--admin-info-border)] bg-[var(--admin-info-subtle)] text-[var(--admin-info)]",
							)}
							onClick={() => setShowPreview((v) => !v)}
						>
							<MonitorPlay className="h-3 w-3" />
							{t("preview.title")}
						</Button>
					)}
				</div>
			</div>

			{/* Dirty banner */}
			{isDirty && (
				<div className="flex items-center gap-2 px-4 py-1.5 bg-[var(--admin-warning-subtle)] border-b border-[var(--admin-warning-border)] text-xs text-[var(--admin-warning)] shrink-0">
					<AlertCircle className="h-3.5 w-3.5 shrink-0" />
					<span className="flex-1">{t("saveHint")}</span>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-[11px] px-2"
						onClick={handleSave}
						disabled={saving || !canEdit}
					>
						{saving ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<Save className="mr-1 h-3 w-3" />
						)}
						Save
					</Button>
				</div>
			)}

			{/* Editor + live preview */}
			<div className="flex min-h-0 flex-1">
				<Tabs
					value={activeTab}
					onValueChange={(tab) => {
						if (tab === activeTab) return;
						if (offersDirty && !window.confirm(tActions("leaveUnsaved")))
							return;
						setOffersDirty(false);
						setActiveTab(tab);
					}}
					className="flex-1 flex flex-col min-h-0"
				>
					<TabsList className="mx-4 mt-2 shrink-0">
						<TabsTrigger value="settings" className="gap-1.5 text-xs">
							<Settings className="h-3.5 w-3.5" />
							Settings
							{isDirty && (
								<span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[var(--admin-warning)]" />
							)}
						</TabsTrigger>
						<TabsTrigger value="items" className="gap-1.5 text-xs">
							<Package className="h-3.5 w-3.5" />
							Items
							{itemsData && (
								<Badge
									variant="secondary"
									className="h-4 px-1 text-[9px] ml-0.5"
								>
									{itemsData.items.length}
								</Badge>
							)}
						</TabsTrigger>
						<TabsTrigger value="translate" className="gap-1.5 text-xs">
							<Languages className="h-3.5 w-3.5" />
							Translate
							{itemsData &&
								(() => {
									const furniSet = new Set(itemsData.furniDataIdList);
									const missing = itemsData.baseItems.filter(
										(b) => !furniSet.has(b.id),
									).length;
									return missing > 0 ? (
										<span className="ml-0.5 rounded-full bg-[var(--admin-warning)] text-[var(--admin-warning-foreground)] text-[9px] px-1 py-0.5 leading-none font-medium">
											{missing}
										</span>
									) : null;
								})()}
						</TabsTrigger>
					</TabsList>

					{/* ── Settings tab ──────────────────────────────── */}
					<TabsContent
						value="settings"
						className="flex-1 overflow-y-auto px-4 pb-4 mt-2"
					>
						<div className="space-y-4">
							{/* Caption + Layout */}
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<Label className="text-xs">Caption</Label>
									<Input
										value={String(form.caption || "")}
										onChange={(e) => update("caption", e.target.value)}
										className="h-8 text-sm"
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">Layout</Label>
									<Select
										value={String(form.pageLayout || "")}
										onValueChange={(v) => update("pageLayout", v)}
									>
										<SelectTrigger className="h-8 text-sm">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{CATALOG_LAYOUTS.map((l) => {
												const color =
													LAYOUT_COLORS[l] || "bg-muted text-muted-foreground";
												return (
													<SelectItem key={l} value={l}>
														<span className="flex items-center gap-2">
															<span
																className={cn(
																	"inline-block h-2 w-2 rounded-full",
																	color,
																)}
															/>
															{l}
														</span>
													</SelectItem>
												);
											})}
										</SelectContent>
									</Select>
									<p className="text-[10px] text-muted-foreground">
										{LAYOUT_DESCRIPTIONS[
											String(form.pageLayout) as CatalogLayout
										] ?? "Custom layout"}
									</p>
								</div>
							</div>

							{/* Order + Rank + Icon */}
							<div className="grid gap-3 sm:grid-cols-3">
								<div className="space-y-1.5">
									<Label className="text-xs">Order</Label>
									<Input
										type="number"
										value={form.orderNum as number}
										onChange={(e) =>
											update("orderNum", parseInt(e.target.value, 10) || 0)
										}
										className="h-8 text-sm"
									/>
								</div>
								{catalogType === "normal" && (
									<div className="space-y-1.5">
										<Label className="text-xs">Min Rank</Label>
										<Input
											type="number"
											value={form.minRank as number}
											onChange={(e) =>
												update("minRank", parseInt(e.target.value, 10) || 1)
											}
											className="h-8 text-sm"
										/>
									</div>
								)}
								<div className="space-y-1.5">
									<Label className="text-xs">Icon</Label>
									<IconPicker
										value={(form.iconImage as number) ?? 0}
										onChange={(v) => update("iconImage", v)}
									/>
								</div>
							</div>

							{/* Toggles */}
							<div className={styles.options}>
								<ToggleRow
									id="ie-enabled"
									disabled={!canEdit || saving}
									label={t("access.enabled")}
									description={t("access.enabledHint")}
									checked={form.enabled === "1"}
									onChange={(v) => update("enabled", v ? "1" : "0")}
								/>
								<ToggleRow
									id="ie-visible"
									disabled={!canEdit || saving}
									label={t("access.visible")}
									description={t("access.visibleHint")}
									checked={form.visible === "1"}
									onChange={(v) => update("visible", v ? "1" : "0")}
								/>
								{catalogType === "normal" && (
									<ToggleRow
										id="ie-club"
										disabled={!canEdit || saving}
										label={t("access.club")}
										description={t("access.clubHint")}
										checked={form.clubOnly === "1"}
										onChange={(v) => update("clubOnly", v ? "1" : "0")}
									/>
								)}
							</div>

							{/* Headline image picker */}
							<div className="space-y-1.5">
								<Label className="text-xs">Headline</Label>
								<CatalogImagePicker
									value={String(form.pageHeadline || "")}
									onChange={(v) => update("pageHeadline", v)}
									type="header"
									label="Headline image"
								/>
								<ImagePreview
									value={String(form.pageHeadline || "")}
									height={50}
								/>
							</div>

							{/* Teaser image picker */}
							<div className="space-y-1.5">
								<Label className="text-xs">Teaser</Label>
								<CatalogImagePicker
									value={String(form.pageTeaser || "")}
									onChange={(v) => update("pageTeaser", v)}
									type="teaser"
									label="Teaser image"
								/>
								<ImagePreview
									value={String(form.pageTeaser || "")}
									height={50}
								/>
							</div>

							{/* Collapsible text fields */}
							<button
								type="button"
								onClick={() => setShowTexts(!showTexts)}
								className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								{showTexts ? (
									<ChevronDown className="h-3.5 w-3.5" />
								) : (
									<ChevronRight className="h-3.5 w-3.5" />
								)}
								Text fields
								{(form.pageText1 ||
									form.pageText2 ||
									form.pageTextDetails ||
									form.pageTextTeaser) && (
									<Badge variant="secondary" className="h-4 px-1 text-[9px]">
										has content
									</Badge>
								)}
							</button>

							{showTexts && (
								<div className="space-y-3 pl-2 border-l-2 border-border/40">
									<div className="space-y-1.5">
										<Label className="text-xs">Text 1</Label>
										<Textarea
											rows={2}
											value={String(form.pageText1 || "")}
											onChange={(e) =>
												update("pageText1", e.target.value || null)
											}
											className="text-sm"
										/>
									</div>
									<div className="space-y-1.5">
										<Label className="text-xs">Text 2</Label>
										<Textarea
											rows={2}
											value={String(form.pageText2 || "")}
											onChange={(e) =>
												update("pageText2", e.target.value || null)
											}
											className="text-sm"
										/>
									</div>
									<div className="space-y-1.5">
										<Label className="text-xs">Text Details</Label>
										<Textarea
											rows={2}
											value={String(form.pageTextDetails || "")}
											onChange={(e) =>
												update("pageTextDetails", e.target.value || null)
											}
											className="text-sm"
										/>
									</div>
									<div className="space-y-1.5">
										<Label className="text-xs">Text Teaser</Label>
										<Textarea
											rows={2}
											value={String(form.pageTextTeaser || "")}
											onChange={(e) =>
												update("pageTextTeaser", e.target.value || null)
											}
											className="text-sm"
										/>
									</div>
									<div className="space-y-1.5">
										<Label className="text-xs">Special</Label>
										<Input
											value={String(form.pageSpecial || "")}
											onChange={(e) =>
												update("pageSpecial", e.target.value || null)
											}
											className="h-8 text-sm"
										/>
									</div>
								</div>
							)}

							{/* Save button */}
							<div className="pt-2">
								<Button
									onClick={handleSave}
									disabled={saving || !isDirty || !canEdit}
									className="w-full"
								>
									{saving ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<Save className="mr-2 h-4 w-4" />
									)}
									{tNavigation("save")}
								</Button>
							</div>
						</div>
					</TabsContent>

					{/* ── Items tab ─────────────────────────────────── */}
					<TabsContent
						value="items"
						className="flex-1 overflow-y-auto px-4 pb-4 mt-2"
					>
						{catalogType === "bc" ? (
							<BcItemsEditor pageId={page.id} canEdit={canEdit} />
						) : itemsError && !itemsData ? (
							<div className="flex items-center justify-center py-12">
								<Button variant="outline" onClick={reloadItems}>
									{t("retryItems")}
								</Button>
							</div>
						) : itemsLoading && !itemsData ? (
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : itemsData ? (
							<div className="space-y-3">
								{/* Toolbar */}
								<div className="flex items-center gap-2 flex-wrap">
									{canEdit && (
										<>
											<QuickAddFurni
												pageId={page.id}
												furniRevisionMap={itemsData.furniRevisionMap}
											/>
											<BulkImportItems
												pageId={page.id}
												onImported={reloadItems}
											/>
										</>
									)}
									<AutoOrganize
										items={itemsData.items}
										currentLayout={page.pageLayout}
										canEdit={canEdit}
										onSorted={reloadItems}
										onApplyLayout={(layout) => update("pageLayout", layout)}
									/>
								</div>

								{/* Items table */}
								<CatalogItemsTable
									initialSearch={
										initialOfferId ? `#${initialOfferId}` : undefined
									}
									onDirtyChange={setOffersDirty}
									onRefresh={reloadItems}
									items={itemsData.items}
									pageId={page.id}
									pageLayout={page.pageLayout}
									canEdit={canEdit}
									interactionTypes={itemsData.interactionTypes}
									furniRevisionMap={itemsData.furniRevisionMap}
									allPages={itemsData.allPages}
									catalog={catalogType}
								/>
							</div>
						) : null}
					</TabsContent>

					{/* ── Translate tab ─────────────────────────────── */}
					<TabsContent
						value="translate"
						className="flex-1 overflow-y-auto px-4 pb-4 mt-2"
					>
						{catalogType === "bc" ? (
							<div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
								Translate tools are available for the shop catalog only.
							</div>
						) : itemsError && !itemsData ? (
							<div className="flex items-center justify-center py-12">
								<Button variant="outline" onClick={reloadItems}>
									{t("retryItems")}
								</Button>
							</div>
						) : itemsLoading && !itemsData ? (
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : itemsData ? (
							<CatalogTranslateTab
								baseItems={itemsData.baseItems}
								catalogNameMap={itemsData.catalogNameMap}
								canEdit={canEdit}
								furniDataIdList={itemsData.furniDataIdList}
								furniDescriptionMap={itemsData.furniDescriptionMap}
								furniRevisionMap={itemsData.furniRevisionMap}
								gamedataHotel={itemsData.gamedataHotel}
							/>
						) : null}
					</TabsContent>
				</Tabs>

				{catalogType === "normal" && showPreview && (
					<LiveCatalogPreview
						form={form}
						items={itemsData?.items ?? null}
						furniRevisionMap={itemsData?.furniRevisionMap ?? {}}
						loadingItems={itemsLoading}
						onApplyLayout={(layout) => update("pageLayout", layout)}
					/>
				)}
			</div>
		</div>
	);
}

// ── Toggle row (inline) ─────────────────────────────────────

function ToggleRow({
	id,
	label,
	description,
	disabled,
	checked,
	onChange,
}: {
	id: string;
	label: string;
	description: string;
	disabled: boolean;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	const t = useTranslations("pages.admin.catalog.workspace.access");
	return (
		<div className={styles.option} data-disabled={disabled || undefined}>
			<div className={styles.optionHeader}>
				<Label htmlFor={id} className={styles.label}>
					{label}
				</Label>
				<div className={styles.control}>
					<span className={styles.state} aria-hidden="true">
						{t(checked ? "yes" : "no")}
					</span>
					<Switch
						id={id}
						checked={checked}
						onCheckedChange={onChange}
						disabled={disabled}
						aria-describedby={`${id}-description`}
					/>
				</div>
			</div>
			<p id={`${id}-description`} className={styles.description}>
				{description}
			</p>
		</div>
	);
}
