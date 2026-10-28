"use client";

import { LayoutGrid, Search, Wand2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { createCatalogPage } from "@/actions/catalog";
import { createBcPage } from "@/actions/catalog-bc";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CatalogSelection } from "@/features/catalog/client/catalog-selection-url";
import { useCatalogNavigation } from "@/features/catalog/client/use-catalog-navigation";
import { useLatestRequest } from "@/features/catalog/client/use-latest-request";
import {
	refreshCatalogTree,
	seedCatalogTotals,
	useCatalogSync,
	useLiveCatalog,
} from "@/features/catalog/client/use-live-catalog";
import { CatalogSearch } from "@/features/catalog/components/catalog-search";
import type { CatalogSearchResult } from "@/features/catalog/domain/search";
import type { RootTab } from "@/types/catalog";
import { AutoCategoryDialog } from "./auto-category-dialog";
import { BreadcrumbBar } from "./breadcrumb-bar";
import { InlineEditor, type PageUpdateData } from "./inline-editor";
import { RootTabs } from "./root-tabs";
import { SortableTree } from "./sortable-tree";
import { type CatalogStatsTotals, StatsBar } from "./stats-bar";
import {
	type CatalogManagerMode,
	CatalogManagerProvider,
	catalogTreeQs,
	useCatalogManager,
} from "./use-catalog-store";

const EMPTY_ROOTS: RootTab[] = [];

interface CatalogManagerProps {
	initialRoots?: RootTab[];
	catalogType?: CatalogManagerMode;
	canEdit?: boolean;
	totals?: CatalogStatsTotals | null;
}

export function CatalogManagerWorkspace({
	initialRoots = EMPTY_ROOTS,
	catalogType = "normal",
	canEdit = false,
	totals = null,
}: CatalogManagerProps) {
	const t = useTranslations("pages.admin.catalog.workspace");
	return (
		<section
			aria-label={t("manager")}
			className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text)]"
		>
			<CatalogManagerProvider
				key={catalogType}
				catalogType={catalogType}
				canEdit={canEdit}
			>
				<CatalogManagerInner
					open
					embedded
					initialRoots={initialRoots}
					totals={totals}
				/>
			</CatalogManagerProvider>
		</section>
	);
}

/**
 * Visual Catalog Manager — matches habbo-next UX (full-viewport editor).
 * Portal overlay (not Base UI Dialog) so the tree + editor mount reliably.
 */
export function CatalogManagerDialog({
	initialRoots = EMPTY_ROOTS,
	catalogType = "normal",
	canEdit = false,
	totals = null,
	triggerLabel,
}: {
	initialRoots?: RootTab[];
	catalogType?: CatalogManagerMode;
	canEdit?: boolean;
	totals?: CatalogStatsTotals | null;
	triggerLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		const previousFocus = document.activeElement as HTMLElement | null;
		const focusFrame = requestAnimationFrame(() =>
			document
				.querySelector<HTMLElement>(
					'[aria-labelledby="visual-catalog-manager-title"] button[aria-label="Close"]',
				)
				?.focus(),
		);
		document.body.style.overflow = "hidden";
		return () => {
			cancelAnimationFrame(focusFrame);
			document.body.style.overflow = prev;
			previousFocus?.focus();
		};
	}, [open]);

	const title = catalogType === "bc" ? "BC Visual Manager" : "Visual Manager";

	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="gap-2"
				onClick={() => setOpen(true)}
			>
				<LayoutGrid className="h-4 w-4" />
				{triggerLabel ?? title}
			</Button>
			{mounted && open
				? createPortal(
						<div className="fixed inset-0 z-50">
							<div className="absolute inset-0 bg-foreground/70" />
							<div
								role="dialog"
								aria-modal="true"
								aria-labelledby="visual-catalog-manager-title"
								className="fixed top-[2.5vh] left-[1vw] flex h-[95vh] max-h-[95vh] w-[98vw] max-w-[98vw] flex-col overflow-hidden rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text)] shadow-2xl"
								style={{ backgroundColor: "var(--admin-canvas)" }}
							>
								<CatalogManagerProvider
									catalogType={catalogType}
									canEdit={canEdit}
								>
									<CatalogManagerInner
										open={open}
										onOpenChange={setOpen}
										initialRoots={initialRoots}
										totals={totals}
									/>
								</CatalogManagerProvider>
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}

function CatalogManagerInner({
	embedded = false,
	open,
	onOpenChange,
	initialRoots,
	totals,
}: {
	embedded?: boolean;
	open: boolean;
	onOpenChange?: (v: boolean) => void;
	initialRoots: RootTab[];
	totals?: CatalogStatsTotals | null;
}) {
	const { state, dispatch, catalogType, canEdit } = useCatalogManager();
	// Server totals are the baseline; after an import the live store holds
	// counts that are newer than both the prop and its 30s server cache.
	const liveTotals = useLiveCatalog().totals[catalogType];
	// The dialog runs on its own page too (Studio embed aside), so it cannot rely
	// on the Studio to keep the shared tree current.
	useCatalogSync();
	useEffect(() => {
		seedCatalogTotals(catalogType, totals);
	}, [catalogType, totals]);
	const catQs = catalogTreeQs(catalogType);
	const rootRequests = useLatestRequest();
	const searchNavigation = useLatestRequest();
	const [searchOpen, setSearchOpen] = useState(false);
	const [autoOpen, setAutoOpen] = useState(false);
	const [searchTarget, setSearchTarget] = useState<{
		offerId: number | null;
		key: number;
	}>({ offerId: null, key: 0 });
	const tActions = useTranslations("pages.admin.actions");
	const t = useTranslations("pages.admin.catalog.workspace");
	const mayLeave = useCallback(
		() => !state.editorDirty || window.confirm(tActions("leaveUnsaved")),
		[state.editorDirty, tActions],
	);
	const mayLeaveRef = useRef(mayLeave);
	mayLeaveRef.current = mayLeave;
	const restoreSelection = useCallback(
		(selection: CatalogSelection) => {
			dispatch({ type: "RESTORE_SELECTION", ...selection });
		},
		[dispatch],
	);
	const saveSelectionUrl = useCatalogNavigation({
		enabled: embedded,
		restore: restoreSelection,
		mayLeave,
	});

	const close = useCallback(() => {
		if (mayLeave()) onOpenChange?.(false);
	}, [mayLeave, onOpenChange]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (embedded || event.key !== "Escape" || event.defaultPrevented) return;
			const target = event.target as HTMLElement;
			// Never steal Escape from inputs/comboboxes (e.g. root name field).
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			const focusedDialog = target.closest?.("[role=dialog]");
			if (
				focusedDialog &&
				focusedDialog.getAttribute("aria-labelledby") !==
					"visual-catalog-manager-title"
			)
				return;
			if (target.closest?.("[role=listbox], [role=menu], [role=combobox]"))
				return;
			event.preventDefault();
			if (searchOpen) {
				searchNavigation.cancel();
				setSearchOpen(false);
				return;
			}
			close();
		};
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (state.editorDirty) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [close, state.editorDirty, embedded, searchOpen, searchNavigation]);

	const loadRootPages = useCallback(async () => {
		const request = rootRequests.start();
		dispatch({ type: "SET_LOADING_ROOT", loading: true });
		try {
			const res = await fetch(`/api/admin/catalog/tree?parentId=-1${catQs}`, {
				signal: request.signal,
			});
			const data = await res.json().catch(() => ({}));
			if (!request.isCurrent()) return;
			if (!res.ok) throw new Error(data.error || "Failed to load roots");
			const pages: RootTab[] = (data.pages || []).map(
				(p: Record<string, unknown>) => ({
					id: Number(p.id),
					caption: String(p.caption ?? ""),
					iconImage: Number(p.iconImage) || 0,
					enabled: String(p.enabled ?? "0"),
					orderNum: Number(p.orderNum) || 0,
				}),
			);
			dispatch({ type: "SET_ROOT_PAGES", pages });
		} catch {
			if (!request.isCurrent()) return;
			toast.error("Failed to load catalog root pages");
			dispatch({ type: "SET_LOADING_ROOT", loading: false });
		}
	}, [dispatch, catQs, rootRequests]);

	/**
	 * A page created, moved or deleted here changes the tree the Studio rail and
	 * the stats bar read from the live store. Refreshing it here keeps both views
	 * truthful without a route re-render; the store coalesces bursts of edits.
	 */
	const onTreeMutation = useCallback(() => {
		void loadRootPages();
		void refreshCatalogTree();
	}, [loadRootPages]);

	// Seed once on opening, then refresh independently of category selection.
	useEffect(() => {
		if (!open) return;
		if (initialRoots.length)
			dispatch({ type: "SET_ROOT_PAGES", pages: initialRoots });
		void loadRootPages();
		return () => rootRequests.cancel();
	}, [open, initialRoots, dispatch, loadRootPages, rootRequests]);

	useEffect(() => {
		if (!open) dispatch({ type: "ON_DIALOG_CLOSE" });
	}, [open, dispatch]);

	const handleTabClick = (id: number) => {
		searchNavigation.cancel();
		if (id === state.activeTabId) return;
		if (!mayLeave()) {
			return;
		}
		setSearchTarget((previous) => ({ ...previous, offerId: null }));
		saveSelectionUrl({ rootId: id, pageId: null });
		dispatch({ type: "SET_ACTIVE_TAB", id });
	};

	const handleCreateRoot = async (caption: string): Promise<boolean> => {
		if (!canEdit) return false;
		try {
			const result =
				catalogType === "bc"
					? await createBcPage({
							parentId: -1,
							caption,
						})
					: await createCatalogPage({
							parentId: -1,
							caption,
						});
			if (!result.ok) throw new Error(result.error);
			await loadRootPages();
			toast.success("Root page created");
			return true;
		} catch {
			toast.error("Failed to create root page");
			return false;
		}
	};

	const handleSelectPage = (id: number) => {
		searchNavigation.cancel();
		if (id === state.selectedPageId) return;
		if (!mayLeave()) {
			return;
		}
		setSearchTarget((previous) => ({ ...previous, offerId: null }));
		saveSelectionUrl({ rootId: state.activeTabId, pageId: id > 0 ? id : null });
		dispatch({ type: "SELECT_PAGE", id: id > 0 ? id : null });
	};

	const handleEditTab = (id: number) => {
		searchNavigation.cancel();
		if (id === state.selectedPageId && id === state.activeTabId) return;
		if (!mayLeave()) return;
		setSearchTarget((previous) => ({ ...previous, offerId: null }));
		saveSelectionUrl({ rootId: id, pageId: id });
		if (state.activeTabId !== id) dispatch({ type: "SET_ACTIVE_TAB", id });
		dispatch({ type: "SELECT_PAGE", id });
	};

	const handleEditorSaved = (updated: PageUpdateData) => {
		dispatch({ type: "UPDATE_NODE", update: { ...updated } });

		const rootIdx = state.rootPages.findIndex((p) => p.id === updated.id);
		if (rootIdx !== -1) {
			const pages = [...state.rootPages];
			pages[rootIdx] = {
				...pages[rootIdx],
				caption: updated.caption,
				enabled: updated.enabled,
			};
			dispatch({ type: "SET_ROOT_PAGES", pages });
		}
	};

	async function openSearchResult(result: CatalogSearchResult) {
		const request = searchNavigation.start();
		try {
			const response = await fetch(
				`/api/admin/catalog/tree?ancestors=${result.pageId}${catQs}`,
				{ signal: request.signal },
			);
			if (!response.ok) throw Error("Navigation failed");
			const data = await response.json();
			if (!request.isCurrent() || !mayLeaveRef.current()) return;
			const rootId = Number(data.ancestors?.[0]?.id ?? result.pageId);
			dispatch({ type: "RESTORE_SELECTION", rootId, pageId: result.pageId });
			saveSelectionUrl({ rootId, pageId: result.pageId });
			setSearchTarget((previous) => ({
				offerId: result.kind === "offer" ? result.id : null,
				key: previous.key + 1,
			}));
			setSearchOpen(false);
		} catch {
			if (request.isCurrent()) toast.error(t("searchFailed"));
		}
	}
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				!(event.ctrlKey || event.metaKey) ||
				!event.shiftKey ||
				event.key.toLowerCase() !== "f"
			)
				return;
			const dialog = (event.target as HTMLElement).closest?.('[role="dialog"]');
			if (
				dialog &&
				dialog.getAttribute("aria-labelledby") !==
					"visual-catalog-manager-title"
			)
				return;
			event.preventDefault();
			setSearchOpen(true);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
	const heading =
		catalogType === "bc"
			? "BC Visual Catalog Manager"
			: "Visual Catalog Manager";

	return (
		<TooltipProvider delayDuration={300}>
			<div
				className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--admin-border)] px-4 py-2.5"
				style={{ backgroundColor: "var(--admin-surface)" }}
			>
				<h2
					id="visual-catalog-manager-title"
					className="flex items-center gap-2 text-base font-semibold leading-none"
				>
					<LayoutGrid className="h-4 w-4" />
					{heading}
				</h2>
				<div className="flex items-center gap-1">
					{canEdit && catalogType === "normal" && (
						<Button
							variant="outline"
							size="sm"
							aria-label={t("autoCategory.title")}
							title={t("autoCategory.title")}
							onClick={() => {
								if (!mayLeave()) return;
								setAutoOpen(true);
							}}
						>
							<Wand2 className="size-4" />
							<span className="hidden sm:inline">
								{t("autoCategory.title")}
							</span>
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						aria-label={t("globalSearch")}
						aria-expanded={searchOpen}
						onClick={() => {
							searchNavigation.cancel();
							setSearchOpen((value) => !value);
						}}
					>
						<Search className="size-4" />
						<span className="hidden sm:inline">{t("globalSearch")}</span>
						<kbd className="hidden lg:inline text-xs">Ctrl Shift F</kbd>
					</Button>
					{!embedded && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							onClick={close}
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>
			{searchOpen && (
				<div className="shrink-0 max-h-[45vh] overflow-y-auto border-b p-2">
					<CatalogSearch
						catalogType={catalogType}
						onNavigate={openSearchResult}
						autoFocus
					/>
				</div>
			)}

			<AutoCategoryDialog
				catalogType={catalogType}
				open={autoOpen}
				onOpenChange={setAutoOpen}
				onCreated={(pageId) => {
					void loadRootPages();
					handleSelectPage(pageId);
				}}
			/>

			<BreadcrumbBar onSelectPage={handleSelectPage} />

			<RootTabs
				tabs={state.rootPages}
				activeTabId={state.activeTabId}
				onTabClick={handleTabClick}
				onEditTab={handleEditTab}
				onCreateRoot={handleCreateRoot}
				onMutation={loadRootPages}
				loading={state.loadingRoot}
			/>

			<div
				className="flex min-h-0 flex-1 overflow-hidden"
				style={{ backgroundColor: "var(--admin-canvas)" }}
			>
				<div
					className={`${state.selectedPageId ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 md:flex-none [&>div]:w-full md:[&>div]:w-80`}
				>
					<SortableTree
						activeTabId={state.activeTabId}
						selectedPageId={state.selectedPageId}
						onSelectPage={handleSelectPage}
						onTreeMutation={onTreeMutation}
						nodeUpdate={null}
					/>
				</div>
				<div
					className={`${state.selectedPageId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}
					style={{ backgroundColor: "var(--admin-canvas)" }}
				>
					<Button
						variant="ghost"
						className="shrink-0 self-start md:hidden"
						onClick={() => handleSelectPage(0)}
					>
						{t("backToCategories")}
					</Button>
					<InlineEditor
						key={`${state.selectedPageId}:${searchTarget.key}`}
						initialOfferId={searchTarget.offerId}
						pageId={state.selectedPageId}
						onSaved={handleEditorSaved}
					/>
				</div>
			</div>

			<StatsBar totals={liveTotals ?? totals} />
		</TooltipProvider>
	);
}
