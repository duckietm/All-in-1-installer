"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Check,
	CircleAlert,
	CloudDownload,
	FileJson2,
	Globe,
	Languages,
	Layers,
	LayoutGrid,
	List,
	ListChecks,
	Loader2,
	Package,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	RefreshCw,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
// The fade-in on the furniture pane is a plain CSS animation
// (.studio-list-fade-in), not motion. It used to be a `motion/react-m` element
// declared with initial opacity 0 and animate opacity 1. That minimal entry
// renders the element but never runs the animation, so the inline style stayed
// at opacity: 0 and the whole furniture list was present, measurable and fully
// loaded — yet invisible. Every other animation in the app uses the full
// motion/react and is unaffected; this was the only motion/react-m usage.
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { deleteImportedFurni } from "@/actions/import-furni";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	refreshCatalogTree,
	useCatalogSync,
	useLiveCatalog,
} from "@/features/catalog/client/use-live-catalog";
import { adminFetch } from "@/lib/admin-fetch";
import type { FurniImportSource } from "@/lib/habbo-gamedata-hotel";
import { readSseStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";
import { BatchProgress } from "./batch-progress";
import { CatalogRail } from "./catalog-rail";
import { CheckboxDot } from "./checkbox-dot";
import { FurnitureJobHistory } from "./furniture-jobs";
import { filterFurniture } from "./studio-filters";
import { getFurniImageUrl, handleImgError } from "./studio-furni-icons";
import { StudioPanelLoading } from "./studio-panel-loading";
import type {
	BatchItemStatus,
	FurniItem,
	FurniStats,
	Meta,
	VerificationSummary,
} from "./studio-types";
import { useFurnitureJobs } from "./use-furniture-jobs";
import { useStudioTranslations } from "./use-studio-translations";

const NitroEditorDialog = lazy(() =>
	import("@/app/admin/import/furni/nitro-editor-dialog").then((module) => ({
		default: module.NitroEditorDialog,
	})),
);
const FurnitureDetailDrawer = lazy(() =>
	import("./furniture-detail-drawer").then((module) => ({
		default: module.FurnitureDetailDrawer,
	})),
);
const ImportReview = lazy(() =>
	import("./import-review").then((module) => ({
		default: module.ImportReview,
	})),
);

// Grid virtualization geometry (px) — matches the grid-card markup below.
const GRID_CARD_W = 150;
const GRID_GAP = 12;
const GRID_ROW_H = 176;

// Persisted UI preferences (survive reloads).
const LS_VIEW_MODE = "studio:viewMode";
const LS_SORT_BY = "studio:sortBy";
const LS_FILTERS = "studio.filters";
const SORT_KEYS = [
	"default",
	"name",
	"classname",
	"category",
	"imported-first",
	"not-imported-first",
] as const;

// Maps internal filter/sort values to their `admin.studio` message keys so the
// visible labels stay translatable without duplicating the option lists.
const STATUS_LABEL_KEYS: Record<string, string> = {
	all: "filters.allStatuses",
	notImported: "filters.statuses.notImported",
	imported: "filters.statuses.imported",
	inCatalog: "filters.statuses.inCatalog",
	missingNitro: "filters.statuses.missingNitro",
	missingFurnidata: "filters.statuses.missingFurnidata",
	missingCatalog: "filters.statuses.missingCatalog",
};
const SORT_LABEL_KEYS: Record<string, string> = {
	default: "filters.sorts.default",
	name: "filters.sorts.name",
	classname: "filters.sorts.classname",
	category: "filters.sorts.category",
	"imported-first": "filters.sorts.importedFirst",
	"not-imported-first": "filters.sorts.notImportedFirst",
};
const TYPE_LABEL_KEYS: Record<string, string> = {
	flooritem: "types.floor",
	wallitem: "types.wall",
};
function readLs<T extends string>(
	key: string,
	fallback: T,
	valid: ReadonlyArray<T>,
): T {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return fallback;
		return valid.includes(raw as T) ? (raw as T) : fallback;
	} catch {
		return fallback;
	}
}
function writeLs(key: string, value: string) {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		/* private mode / quota — ignore */
	}
}

// Wraps the first case-insensitive match of `query` inside `text` in an accent
// mark so users can see where their search hit.
function Highlighted({ text, query }: { text: string; query: string }) {
	if (!query) return text;
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index === -1) return text;
	return (
		<>
			{text.slice(0, index)}
			<mark className="rounded-[2px] bg-[var(--admin-accent)]/25 text-inherit">
				{text.slice(index, index + query.length)}
			</mark>
			{text.slice(index + query.length)}
		</>
	);
}

// Table layout: a shared grid template keeps the sticky header and each
// virtualized row in perfect column alignment.
const TABLE_COLS =
	"36px 48px minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.6fr) minmax(0,0.7fr) minmax(0,1fr) 112px";
const TABLE_ROW_H = 40;

export function StudioClient({
	actorId,
	source,
	defaultTranslate,
}: {
	actorId?: number;
	source: FurniImportSource;
	defaultTranslate: boolean;
}) {
	const t = useTranslations("admin.studio");
	const typeLabel = (type: string) =>
		TYPE_LABEL_KEYS[type] ? t(TYPE_LABEL_KEYS[type]) : type;
	const [review, setReview] = useState<{
		items: FurniItem[];
		single: boolean;
		cloneAll?: boolean;
	} | null>(null);
	const jobs = useFurnitureJobs(
		() => {
			void fetchItems(activeSearch, 1, activeSource);
			void fetchStats();
			// A durable job derives its "Imported Furniture" pages server-side, so
			// the rail cannot predict them either — pull the tree and totals.
			void refreshCatalogTree();
		},
		false,
		actorId,
	);
	const [preparingReview, setPreparingReview] = useState(false);
	// Catalog tree — read from the live store so pages created by an import show
	// up without re-rendering the route.
	const tree = useLiveCatalog().tree;
	const [selectedPage, setSelectedPage] = useState<number | null>(null);
	const [railOpen, setRailOpen] = useState(false);
	useCatalogSync();
	useEffect(() => {
		setRailOpen(window.matchMedia("(min-width: 1024px)").matches);
	}, []);

	// Search & list
	const [searchTerm, setSearchTerm] = useState("");
	const [activeSearch, setActiveSearch] = useState("");
	const [items, setItems] = useState<FurniItem[]>([]);
	const [meta, setMeta] = useState<Meta | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	// Custom clone sources (retro hotels); empty string = official Habbo furnidata
	const [sources, setSources] = useState<Array<{ id: string; name: string }>>(
		[],
	);
	const [activeSource, setActiveSource] = useState<string>("");
	const [activeSourceName, setActiveSourceName] = useState("");

	// Filter persistence in localStorage
	const storedFilters = JSON.parse(
		localStorage.getItem(LS_FILTERS) ||
			'{"typeFilter":"all","categoryFilter":"all","statusFilter":"all"}',
	);
	const [typeFilter, setTypeFilter] = useState<string>(
		storedFilters.typeFilter || "all",
	);
	const [categoryFilter, setCategoryFilter] = useState<string>(
		storedFilters.categoryFilter || "all",
	);
	const [statusFilter, setStatusFilter] = useState<string>(
		storedFilters.statusFilter || "all",
	);
	// Sync to localStorage on change
	useEffect(() => {
		localStorage.setItem(
			LS_FILTERS,
			JSON.stringify({
				typeFilter,
				categoryFilter,
				statusFilter,
			}),
		);
	}, [typeFilter, categoryFilter, statusFilter]);
	const [sortBy, setSortBy] = useState<string>(() =>
		readLs(LS_SORT_BY, "default", SORT_KEYS),
	);
	const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
		readLs(LS_VIEW_MODE, "list", ["grid", "list"] as const),
	);
	const changeViewMode = (mode: "grid" | "list") => {
		setViewMode(mode);
		writeLs(LS_VIEW_MODE, mode);
	};
	const changeSortBy = (value: string) => {
		setSortBy(value);
		writeLs(LS_SORT_BY, value);
	};
	const searchRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Stats
	const [stats, setStats] = useState<FurniStats | null>(null);

	// Selection + detail
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [detail, setDetail] = useState<FurniItem | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	// Mirrors `items` synchronously so "select all results" can read the
	// fully-loaded list right after the last page resolves.
	const itemsRef = useRef<FurniItem[]>([]);
	// Bumped when the list query changes (search/source) to cancel a running
	// bulk "select all" loop.
	const listGenRef = useRef(0);
	const detailOrigin = useRef<{
		top: number;
		trigger: HTMLElement | null;
	} | null>(null);
	const openDetail = (item: FurniItem) => {
		detailOrigin.current = {
			top: listRef.current?.scrollTop ?? 0,
			trigger:
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null,
		};
		setDetail(item);
	};
	useLayoutEffect(() => {
		if (detail || !detailOrigin.current) return;
		const origin = detailOrigin.current;
		detailOrigin.current = null;
		if (listRef.current) listRef.current.scrollTop = origin.top;
		if (origin.trigger?.isConnected)
			origin.trigger.focus({ preventScroll: true });
	}, [detail]);
	const sourceGeneration = useRef(0);
	const listRequest = useRef<AbortController | null>(null);
	useEffect(() => () => listRequest.current?.abort(), []);

	// Import state
	const importingId = jobs.busy ? (review?.items[0]?.classname ?? null) : null;
	const [batchProgress, setBatchProgress] = useState<Map<
		string,
		BatchItemStatus
	> | null>(null);
	const [batchDone, setBatchDone] = useState(false);
	const batchDoneRef = useRef(false);
	const markBatchDone = useCallback(() => {
		batchDoneRef.current = true;
		setBatchDone(true);
	}, []);
	const [batchSucceeded, setBatchSucceeded] = useState(0);
	const [batchFailed, setBatchFailed] = useState(0);
	const [batchCancelling, setBatchCancelling] = useState(false);
	const [verification, setVerification] = useState<VerificationSummary | null>(
		null,
	);
	const batchAbortRef = useRef<AbortController | null>(null);
	// How many items the batch endpoints process in parallel.
	const [concurrency, setConcurrency] = useState(4);

	// Nitro editor
	const [editingClassname, setEditingClassname] = useState<string | null>(null);

	// Delete confirm
	const [deleting, setDeleting] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	// Confirm dialog for clone all
	const { confirm, dialog: confirmDialog } = useConfirmDialog();

	// Clone source stats (shown when a clone source is active)
	const [cloneStats, setCloneStats] = useState<{
		total: number;
		present: number;
		clonable: number;
	} | null>(null);
	const [cloneAllCancelling, setCloneAllCancelling] = useState(false);
	const cloneAllAbortRef = useRef<AbortController | null>(null);
	const batchStartTimeRef = useRef<number>(0);
	const [failedClassnames, setFailedClassnames] = useState<string[]>([]);

	// Nitro regeneration (missing .nitro)
	const [regeneratingNitro, setRegeneratingNitro] = useState<Set<string>>(
		new Set(),
	);

	const {
		ALL_LANGS,
		translate,
		setTranslate,
		translateLangs,
		setTranslateLangs,
		langPickerOpen,
		setLangPickerOpen,
		buildingLanguages,
		globalTranslate,
		buildAllLanguages,
		toggleLang,
		onGlobalTranslateChange,
	} = useStudioTranslations(defaultTranslate);

	const categories = useMemo(() => {
		const cats = new Set(items.map((i) => i.category).filter(Boolean));
		return ["all", ...Array.from(cats).sort()];
	}, [items]);

	const filteredItems = useMemo(
		() =>
			filterFurniture(items, {
				typeFilter,
				categoryFilter,
				statusFilter,
				sortBy,
			}),
		[items, typeFilter, categoryFilter, statusFilter, sortBy],
	);

	const allSelected = useMemo(
		() =>
			filteredItems.length > 0 &&
			filteredItems.every((i) => selected.has(i.classname)),
		[filteredItems, selected],
	);

	const hasMorePages = meta ? meta.currentPage < meta.lastPage : false;

	// ── Grid virtualization ─────────────────────────────────────────
	const [gridCols, setGridCols] = useState(1);
	useLayoutEffect(() => {
		const el = listRef.current;
		if (viewMode !== "grid" || !el) return;
		const update = () => {
			const width = Math.max(el.clientWidth - 24, 100);
			const cols = Math.max(
				1,
				Math.floor((width + GRID_GAP) / (GRID_CARD_W + GRID_GAP)),
			);
			setGridCols((previous) => (previous === cols ? previous : cols));
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, [viewMode]);

	const gridRowCount =
		viewMode === "grid" ? Math.ceil(filteredItems.length / gridCols) : 0;
	const gridVirtualizer = useVirtualizer({
		count: gridRowCount,
		getScrollElement: () => listRef.current,
		estimateSize: () => GRID_ROW_H,
		overscan: 5,
	});
	const tableVirtualizer = useVirtualizer({
		count: viewMode === "list" ? filteredItems.length : 0,
		getScrollElement: () => listRef.current,
		estimateSize: () => TABLE_ROW_H,
		overscan: 8,
	});

	// Infinite scroll: auto-load the next page when the sentinel enters view.
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	// Bulk "select all results" run state; guards the sentinel while pages load.
	const [loadingAll, setLoadingAll] = useState(false);
	const loadingAllRef = useRef(false);

	const fetchStats = useCallback(async () => {
		try {
			const res = await adminFetch("/api/admin/import/furni?action=stats");
			if (res.ok) {
				const data = await res.json();
				setStats(data);
			}
		} catch {
			/* ignore */
		}
	}, []);

	const fetchItems = useCallback(
		async (
			search: string,
			page: number,
			source?: string,
		): Promise<FurniItem[] | null> => {
			listRequest.current?.abort();
			const controller = new AbortController();
			listRequest.current = controller;
			setLoading(true);
			setError("");
			try {
				const qs = new URLSearchParams({ page: String(page) });
				if (search) qs.set("search", search);
				if (source) qs.set("source", source);
				const res = await adminFetch(
					`/api/admin/import/furni?${qs.toString()}`,
					{ signal: controller.signal },
				);
				if (controller.signal.aborted) return null;
				if (!res.ok) {
					setError(`Request failed (${res.status})`);
					setLoading(false);
					return null;
				}
				const data = await res.json();
				if (controller.signal.aborted) return null;
				const fetched: FurniItem[] = data.items ?? [];
				if (page === 1) {
					itemsRef.current = fetched;
					setItems(fetched);
					const available = new Set(fetched.map((item) => item.classname));
					setSelected(
						(previous) =>
							new Set(
								[...previous].filter((classname) => available.has(classname)),
							),
					);
					setDetail((previous) =>
						previous
							? (fetched.find(
									(item) => item.classname === previous.classname,
								) ?? null)
							: null,
					);
				} else {
					// Pages can arrive out of order (infinite scroll + select-all races);
					// skip classnames that are already present.
					const prev = itemsRef.current;
					const seen = new Set(prev.map((item) => item.classname));
					const fresh = fetched.filter((item) => !seen.has(item.classname));
					if (fresh.length > 0) {
						const next = [...prev, ...fresh];
						itemsRef.current = next;
						setItems(next);
					}
				}
				setMeta(data.meta ?? null);
				return fetched;
			} catch {
				if (!controller.signal.aborted) setError("Network error");
				return null;
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		},
		[],
	);

	// Infinite scroll: auto-load the next page when the sentinel enters view.
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || !hasMorePages) return;
		let cancelled = false;
		const observer = new IntersectionObserver(
			(entries) => {
				if (cancelled) return;
				if (
					entries.some((e) => e.isIntersecting) &&
					!loading &&
					!loadingAll &&
					!batchProgress
				) {
					fetchItems(activeSearch, (meta?.currentPage ?? 1) + 1, activeSource);
				}
			},
			{ root: listRef.current, rootMargin: "700px 0px" },
		);
		observer.observe(el);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [
		hasMorePages,
		meta?.currentPage,
		loading,
		loadingAll,
		batchProgress,
		activeSearch,
		activeSource,
		fetchItems,
	]);

	// Floating "back to top" affordance once the list is long.
	const [showBackToTop, setShowBackToTop] = useState(false);
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		let raf = 0;
		const onScroll = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setShowBackToTop(el.scrollTop > 600);
			});
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener("scroll", onScroll);
		};
	}, []);

	const changeSource = (sourceId: string) => {
		sourceGeneration.current += 1;
		listGenRef.current += 1;
		setConfirmDelete(false);
		setDeleting(null);
		setEditingClassname(null);
		listRequest.current?.abort();
		detailOrigin.current = null;
		setDetail(null);
		setReview(null);
		setActiveSource(sourceId);
		setActiveSourceName(
			sourceId ? (sources.find((s) => s.id === sourceId)?.name ?? "") : "",
		);
		setSelected(new Set());
		setItems([]);
		setActiveSearch("");
		setSearchTerm("");
		setCloneStats(null);
		setBatchProgress(null);
		fetchCloneStats(sourceId);
	};

	const fetchSources = useCallback(async () => {
		try {
			const res = await adminFetch("/api/admin/import/clone?action=sources");
			if (res.ok) {
				const data = await res.json();
				setSources(data.sources ?? []);
			}
		} catch {
			/* ignore */
		}
	}, []);

	const fetchCloneStats = useCallback(async (sourceId: string) => {
		if (!sourceId) {
			setCloneStats(null);
			return;
		}
		try {
			const res = await adminFetch(
				`/api/admin/import/clone?source=${encodeURIComponent(sourceId)}`,
			);
			if (res.ok) {
				const data = await res.json();
				setCloneStats(data.stats ?? null);
			}
		} catch {
			/* ignore */
		}
	}, []);

	async function prepareCloneReview() {
		if (!activeSource || preparingReview) return;
		const generation = sourceGeneration.current;
		setPreparingReview(true);
		try {
			const response = await adminFetch(
				"/api/admin/import/clone?source=" +
					encodeURIComponent(activeSource) +
					"&action=clonable",
			);
			const result = await response.json();
			if (generation !== sourceGeneration.current) return;
			if (!response.ok || !Array.isArray(result.classnames))
				throw new Error(result.error || t("toasts.loadMissingFailed"));
			const missing = new Set<string>(result.classnames);
			if (!missing.size) {
				toast.info(t("toasts.allImported"));
				return;
			}
			const collected = new Map<string, FurniItem>();
			let page = 1,
				lastPage = 1;
			do {
				const res = await adminFetch(
					"/api/admin/import/furni?source=" +
						encodeURIComponent(activeSource) +
						"&page=" +
						page,
				);
				const data = await res.json();
				if (generation !== sourceGeneration.current) return;
				if (
					!res.ok ||
					!Array.isArray(data.items) ||
					!Number.isFinite(data.meta?.lastPage)
				)
					throw new Error(data.error || t("toasts.prepareFailed"));
				for (const item of data.items as FurniItem[])
					if (missing.has(item.classname)) collected.set(item.classname, item);
				lastPage = data.meta.lastPage;
				page++;
			} while (page <= lastPage && collected.size < missing.size);
			if (generation !== sourceGeneration.current) return;
			if (collected.size !== missing.size)
				throw new Error(t("toasts.sourceChanged"));
			setReview({
				items: [...collected.values()],
				single: false,
				cloneAll: true,
			});
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setPreparingReview(false);
		}
	}

	useEffect(() => {
		fetchItems("", 1, activeSource);
		fetchStats();
		fetchSources();
	}, [fetchItems, fetchStats, fetchSources, activeSource]);

	// Debounced auto-search (also triggered by the "/" shortcut focus).
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			if (searchTerm !== activeSearch) {
				listGenRef.current += 1;
				setActiveSearch(searchTerm);
				fetchItems(searchTerm, 1, activeSource);
			}
		}, 400);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [searchTerm, fetchItems, activeSearch, activeSource]);

	// Keep detail in sync with the refreshed list.
	useEffect(() => {
		if (!detail) return;
		const updated = items.find((i) => i.classname === detail.classname);
		if (updated) setDetail(updated);
	}, [items, detail]);

	const clearFilters = () => {
		setTypeFilter("all");
		setCategoryFilter("all");
		setStatusFilter("all");
		setSelectedPage(null);
	};
	const clearSearch = () => {
		listGenRef.current += 1;
		setSearchTerm("");
		setActiveSearch("");
		fetchItems("", 1, activeSource);
	};

	const submitSearch = () => {
		listGenRef.current += 1;
		setActiveSearch(searchTerm);
		fetchItems(searchTerm, 1, activeSource);
	};

	function toggleSelect(classname: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(classname)) next.delete(classname);
			else next.add(classname);
			return next;
		});
	}

	const toggleAll = useCallback(() => {
		if (allSelected) {
			const toRemove = new Set(filteredItems.map((i) => i.classname));
			setSelected((prev) => {
				const next = new Set(prev);
				for (const cn of toRemove) next.delete(cn);
				return next;
			});
		} else {
			setSelected((prev) => {
				const next = new Set(prev);
				for (const i of filteredItems) next.add(i.classname);
				return next;
			});
		}
	}, [allSelected, filteredItems]);

	// Bulk "select every matching result": loads all remaining pages in the
	// background, then selects whatever matches the active filters. Cancels
	// itself when the query (search/source) changes or the request is aborted.
	const selectAllResults = useCallback(async () => {
		if (loadingAllRef.current) return;
		const gen = listGenRef.current;
		const search = activeSearch;
		const source = activeSource;
		const first = meta?.currentPage ?? 1;
		const last = meta?.lastPage ?? first;
		if (first >= last) {
			// Everything is already loaded — just select the visible matches.
			setSelected((prev) => {
				const next = new Set(prev);
				for (const item of filteredItems) next.add(item.classname);
				return next;
			});
			return;
		}
		loadingAllRef.current = true;
		setLoadingAll(true);
		try {
			for (let page = first + 1; page <= last; page += 1) {
				if (listGenRef.current !== gen) break;
				const got = await fetchItems(search, page, source);
				if (!got) break;
			}
			if (listGenRef.current === gen) {
				const matching = filterFurniture(itemsRef.current, {
					typeFilter,
					categoryFilter,
					statusFilter,
					sortBy,
				});
				setSelected((prev) => {
					const next = new Set(prev);
					for (const item of matching) next.add(item.classname);
					return next;
				});
			}
		} finally {
			loadingAllRef.current = false;
			setLoadingAll(false);
		}
	}, [
		activeSearch,
		activeSource,
		meta?.currentPage,
		meta?.lastPage,
		filteredItems,
		typeFilter,
		categoryFilter,
		statusFilter,
		sortBy,
		fetchItems,
	]);

	// Keyboard shortcuts: "/" focus search, Ctrl/Cmd+A select all, Esc clear.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (review || editingClassname || confirmDelete || e.defaultPrevented)
				return;
			const tag = (e.target as HTMLElement)?.tagName;
			const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
			if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isInput) {
				e.preventDefault();
				searchRef.current?.focus();
			}
			if (e.key === "a" && (e.metaKey || e.ctrlKey) && !isInput) {
				e.preventDefault();
				toggleAll();
			}
			if (e.key === "Escape" && !isInput) {
				if (detail) {
					e.preventDefault();
					setDetail(null);
					return;
				}
				setSelected(new Set());
				searchRef.current?.blur();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [toggleAll, review, editingClassname, confirmDelete, detail]);

	async function importBatch(
		requested?: string[],
		reviewedItems?: FurniItem[],
	) {
		const toImport = (
			reviewedItems ?? (requested ? items : filteredItems)
		).filter(
			(i) =>
				(requested
					? requested.includes(i.classname)
					: selected.has(i.classname)) &&
				(!!reviewedItems || !i.alreadyImported),
		);
		if (toImport.length === 0) {
			toast.info(t("toasts.selectNotImported"));
			return;
		}

		batchDoneRef.current = false;
		setBatchDone(false);
		setBatchSucceeded(0);
		setBatchFailed(0);
		setBatchCancelling(false);
		setFailedClassnames([]);
		batchStartTimeRef.current = Date.now();

		const initial = new Map<string, BatchItemStatus>();
		for (const i of toImport) {
			initial.set(i.classname, { classname: i.classname, status: "pending" });
		}
		setBatchProgress(initial);

		const abort = new AbortController();
		batchAbortRef.current = abort;

		try {
			const res = await adminFetch("/api/admin/import/furni/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sourceId: activeSource || undefined,
					repairExisting: true,
					items: toImport.map((i) => ({
						id: i.id,
						classname: i.classname,
						name: i.name,
						description: i.description,
						type: i.type,
						revision: i.revision,
						category: i.category,
					})),
					concurrency,
					translate,
					langs:
						translate && translateLangs.length > 0 ? translateLangs : undefined,
				}),
				signal: abort.signal,
			});

			if (!res.ok || !res.body) {
				toast.error(t("toasts.batchFailed", { status: res.status }));
				setBatchProgress(null);
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					try {
						const event = JSON.parse(line.slice(6));
						if (event.type === "item_progress") {
							setBatchProgress((prev) => {
								if (!prev) return prev;
								const next = new Map(prev);
								next.set(event.classname, {
									classname: event.classname,
									status: event.status,
									message: event.message,
									warnings: event.warnings,
									itemId: event.itemId,
								});
								return next;
							});
							if (event.status === "done") {
								setItems((prev) =>
									prev.map((i) =>
										i.classname === event.classname
											? { ...i, alreadyImported: true, nitroExists: true }
											: i,
									),
								);
							} else if (event.status === "failed") {
								setFailedClassnames((prev) =>
									prev.includes(event.classname)
										? prev
										: [...prev, event.classname],
								);
							}
						} else if (event.type === "batch_complete") {
							setBatchSucceeded(event.succeeded);
							setBatchFailed(event.failed);
							setVerification({
								offerIdsFixed: event.offerIdsFixed ?? 0,
								furniDataFixedIds: event.furniDataFixedIds ?? 0,
								furniDataMissing: event.furniDataMissing ?? 0,
								furniDataConflicts: event.furniDataConflicts ?? 0,
								nitrosSynced: event.nitrosSynced ?? [],
								iconsSynced: event.iconsSynced ?? [],
								ownershipFixed: event.ownershipFixed ?? [],
							});
							markBatchDone();
						}
					} catch {
						/* skip malformed */
					}
				}
			}
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				toast.info(t("toasts.importCancelled"));
			} else if ((err as Error).name === "TimeoutError") {
				toast.error(t("toasts.importTimeout"));
			} else if (err instanceof TypeError && err.message?.includes("fetch")) {
				toast.error(t("toasts.networkUpload"));
			} else {
				toast.error(
					t("toasts.unexpectedImport", {
						message: err instanceof Error ? err.message : String(err),
					}),
				);
			}
		} finally {
			batchAbortRef.current = null;
			setBatchCancelling(false);
			setSelected(new Set());
			fetchStats();
			// The importers derive their "Imported Furniture" category pages from
			// furnidata, so the client cannot predict which pages appeared. Pull the
			// tree over the API instead of re-rendering the route.
			void refreshCatalogTree();
			if (!batchDoneRef.current) markBatchDone();
		}
	}

	const cancelBatch = () => {
		if (batchAbortRef.current) {
			setBatchCancelling(true);
			batchAbortRef.current.abort();
		}
	};

	const cancelCloneAll = () => {
		if (cloneAllAbortRef.current) {
			setCloneAllCancelling(true);
			cloneAllAbortRef.current.abort();
		}
	};

	async function retryFailed(failed: string[]) {
		if (failed.length === 0) return;
		if (!activeSource) {
			await importBatch(failed);
			return;
		}
		// For clone sources, re-run cloneAllMissing with only the failed classnames
		batchDoneRef.current = false;
		setBatchDone(false);
		setBatchSucceeded(0);
		setBatchFailed(0);
		setFailedClassnames([]);
		batchStartTimeRef.current = Date.now();

		const initial = new Map<string, BatchItemStatus>();
		for (const cn of failed) {
			initial.set(cn, { classname: cn, status: "pending" });
		}
		setBatchProgress(initial);

		const abort = new AbortController();
		cloneAllAbortRef.current = abort;
		let okCount = 0;
		let failCount = 0;

		try {
			const res = await adminFetch("/api/admin/import/clone/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sourceId: activeSource,
					classnames: failed,
					concurrency,
					final: true,
				}),
				signal: abort.signal,
			});

			if (!res.ok || !res.body) {
				toast.error(t("toasts.retryFailed", { status: res.status }));
				setBatchProgress(null);
				return;
			}

			await readSseStream(
				res.body,
				(evt) => {
					if (evt.type === "item_progress") {
						const cn = String(evt.classname ?? "");
						setBatchProgress((prev) => {
							if (!prev) return prev;
							const next = new Map(prev);
							next.set(cn, {
								classname: cn,
								status: evt.status as BatchItemStatus["status"],
								message: evt.message as string | undefined,
							});
							return next;
						});
						if (evt.status === "done" || evt.status === "failed") {
							if (evt.status === "failed") {
								setFailedClassnames((prev) =>
									prev.includes(cn) ? prev : [...prev, cn],
								);
							}
						}
					}
					if (evt.type === "batch_complete") {
						okCount += Number(evt.succeeded ?? 0);
						failCount += Number(evt.failed ?? 0);
					}
				},
				abort.signal,
			);

			setBatchSucceeded(okCount);
			setBatchFailed(failCount);
			markBatchDone();

			if (okCount > 0) {
				toast.success(t("toasts.importedAgain", { count: okCount }));
			}
			fetchItems(activeSearch, 1, activeSource);
			fetchStats();
			fetchCloneStats(activeSource);
		} catch (err) {
			if ((err as Error)?.name !== "AbortError") {
				toast.error(t("toasts.retryConnection"));
				setBatchProgress(null);
			}
		} finally {
			cloneAllAbortRef.current = null;
		}
	}

	async function deleteItem() {
		if (!deleting) return;
		try {
			const result = await deleteImportedFurni({ classname: deleting });
			if (result.ok) {
				const data = result.data as {
					deletedFiles: string[];
					errors?: string[];
				};
				setItems((prev) => prev.filter((i) => i.classname !== deleting));
				setSelected((prev) => {
					const next = new Set(prev);
					next.delete(deleting);
					return next;
				});
				if (detail?.classname === deleting) setDetail(null);
				fetchStats();
				toast.success(
					t("toasts.deleted", {
						name: deleting,
						count: data.deletedFiles?.length ?? 0,
					}),
				);
			} else {
				toast.error(result.error || t("toasts.deleteFailed"));
			}
		} catch {
			toast.error(t("toasts.networkError"));
		} finally {
			setDeleting(null);
			setConfirmDelete(false);
		}
	}

	async function regenNitro(item: FurniItem) {
		setRegeneratingNitro((prev) => new Set(prev).add(item.classname));
		try {
			const res = await adminFetch("/api/admin/import/furni", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ classname: item.classname, revision: item.revision }],
				}),
			});
			const data = await res.json();
			if (res.ok && data.succeeded > 0) {
				setItems((prev) =>
					prev.map((i) =>
						i.classname === item.classname ? { ...i, nitroExists: true } : i,
					),
				);
				toast.success(t("toasts.regenerated", { name: item.classname }));
			} else {
				toast.error(
					data.results?.[0]?.warning ||
						data.error ||
						t("toasts.regenerationFailed"),
				);
			}
		} catch {
			toast.error(t("toasts.networkError"));
		} finally {
			setRegeneratingNitro((prev) => {
				const next = new Set(prev);
				next.delete(item.classname);
				return next;
			});
		}
	}

	const [bulkDeleting, setBulkDeleting] = useState(false);
	const [bulkRegenning, setBulkRegenning] = useState(false);
	const [bulkFurnidata, setBulkFurnidata] = useState(false);

	async function bulkDeleteSelected() {
		if (selectedImported.length === 0) return;
		const confirmed = await confirm({
			title: t("confirm.deleteTitle", { count: selectedImported.length }),
			description: t("confirm.deleteDescription", {
				count: selectedImported.length,
			}),
			confirmLabel: t("confirm.deleteConfirm"),
			variant: "danger",
		});
		if (!confirmed) return;

		setBulkDeleting(true);
		let deleted = 0;
		let failed = 0;
		try {
			for (const item of selectedImported) {
				try {
					const result = await deleteImportedFurni({
						classname: item.classname,
					});
					if (result.ok) {
						deleted++;
					} else {
						failed++;
					}
				} catch {
					failed++;
				}
			}
			setItems((prev) => prev.filter((i) => !selected.has(i.classname)));
			setSelected(new Set());
			fetchStats();
			toast.success(
				failed > 0
					? t("toasts.bulkDeletedFailed", {
							deleted,
							failed,
						})
					: t("toasts.bulkDeleted", { count: deleted }),
			);
		} catch {
			toast.error(t("toasts.bulkDeleteFailed"));
		} finally {
			setBulkDeleting(false);
		}
	}

	async function bulkRegenNitro() {
		if (selectedMissingNitro.length === 0) return;
		setBulkRegenning(true);
		const cns = selectedMissingNitro.map((i) => i.classname);
		setRegeneratingNitro((prev) => {
			const next = new Set(prev);
			for (const cn of cns) next.add(cn);
			return next;
		});
		try {
			const res = await adminFetch("/api/admin/import/furni", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: selectedMissingNitro.map((i) => ({
						classname: i.classname,
						revision: i.revision,
					})),
				}),
			});
			const data = await res.json();
			if (res.ok) {
				const succeededClassnames = new Set<string>(
					(data.results ?? [])
						.filter((r: { ok: boolean }) => r.ok)
						.map((r: { classname: string }) => r.classname),
				);
				setItems((prev) =>
					prev.map((i) =>
						succeededClassnames.has(i.classname)
							? { ...i, nitroExists: true }
							: i,
					),
				);
				const succeeded = Number(data.succeeded ?? 0);
				const failed = Number(data.failed ?? 0);
				toast.success(
					failed > 0
						? t("toasts.regeneratedBulkFailed", {
								succeeded,
								failed,
							})
						: t("toasts.regeneratedBulk", { count: succeeded }),
				);
			} else {
				toast.error(data.error || t("toasts.regenerationFailed"));
			}
		} catch {
			toast.error(t("toasts.networkError"));
		} finally {
			setRegeneratingNitro((prev) => {
				const next = new Set(prev);
				for (const cn of cns) next.delete(cn);
				return next;
			});
			setBulkRegenning(false);
		}
	}

	async function bulkAddFurnidata() {
		if (selectedMissingFurnidata.length === 0) return;
		setBulkFurnidata(true);
		const wanted = selectedMissingFurnidata.map((i) => i.classname);
		try {
			const res = await adminFetch("/api/admin/import/furni/resync", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ classnames: wanted }),
			});
			const data = await res.json();
			if (res.ok) {
				const failedClassnames = new Set<string>(
					((data.errors ?? []) as Array<{ classname: string }>).map(
						(e) => e.classname,
					),
				);
				const fixedClassnames = new Set(
					wanted.filter((cn) => !failedClassnames.has(cn)),
				);
				setItems((prev) =>
					prev.map((i) =>
						fixedClassnames.has(i.classname) ? { ...i, hasFurnidata: true } : i,
					),
				);
				const fixed = Number(data.resynced ?? fixedClassnames.size);
				const failed = Number(data.failed ?? 0);
				toast.success(
					failed > 0
						? t("toasts.furnidataAddedFailed", { fixed, failed })
						: t("toasts.furnidataAdded", { count: fixed }),
				);
			} else {
				toast.error(data.error || t("toasts.addFurnidataFailed"));
			}
		} catch {
			toast.error(t("toasts.networkError"));
		} finally {
			setBulkFurnidata(false);
		}
	}

	const selectedNonImported = useMemo(
		() =>
			filteredItems.filter(
				(i) => selected.has(i.classname) && !i.alreadyImported,
			).length,
		[filteredItems, selected],
	);

	const missingNitroCount = useMemo(
		() =>
			filteredItems.filter((i) => i.alreadyImported && !i.nitroExists).length,
		[filteredItems],
	);

	const missingFurnidataCount = useMemo(
		() =>
			filteredItems.filter((i) => i.alreadyImported && i.hasFurnidata === false)
				.length,
		[filteredItems],
	);

	const selectedImported = useMemo(
		() =>
			filteredItems.filter(
				(i) => selected.has(i.classname) && i.alreadyImported,
			),
		[filteredItems, selected],
	);

	const selectedMissingNitro = useMemo(
		() => selectedImported.filter((i) => !i.nitroExists),
		[selectedImported],
	);

	const selectedMissingFurnidata = useMemo(
		() => selectedImported.filter((i) => i.hasFurnidata === false),
		[selectedImported],
	);

	const notImportedCount = useMemo(
		() =>
			activeSource && cloneStats
				? cloneStats.clonable
				: filteredItems.filter((i) => i.alreadyImported === false).length,
		[filteredItems, activeSource, cloneStats],
	);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
			<FurnitureJobHistory state={jobs} />
			{/* ── Header ─────────────────────────────────────────── */}
			<header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-3 sm:px-4">
				<div className="flex items-center gap-2.5">
					<div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/30 to-[var(--admin-accent)]/10">
						<Sparkles size={16} className="text-[var(--admin-accent)]" />
					</div>
					<div>
						<h1
							style={{ fontSize: 20, margin: 0 }}
							className="text-base font-extrabold leading-tight text-[var(--admin-text)]"
						>
							{t("workspace.title")}
						</h1>
						<p className="text-[0.65rem] uppercase tracking-wider text-[var(--admin-text-muted)]">
							{activeSourceName || source.label} {t("workspace.furnidata")}
						</p>
					</div>
				</div>

				<div className="flex min-w-[180px] flex-1 items-center gap-2">
					<div className="relative w-full max-w-md">
						<Search
							size={14}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--admin-text-muted)]"
						/>
						<Input
							aria-label={t("aria.search")}
							ref={searchRef}
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") submitSearch();
								if (e.key === "Escape") clearSearch();
							}}
							placeholder={t("aria.searchPlaceholder")}
							style={{ paddingLeft: 32, paddingRight: 32 }}
							className="pl-8 pr-8"
						/>
						{searchTerm ? (
							<button
								type="button"
								onClick={clearSearch}
								aria-label={t("aria.clearSearch")}
								className="absolute right-2 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center rounded-md text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)]"
							>
								<X size={12} />
							</button>
						) : null}
					</div>
					{meta && (
						<span className="shrink-0 text-xs font-semibold text-[var(--admin-text-muted)]">
							{t("workspace.results", {
								count: meta.total.toLocaleString(),
							})}
						</span>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{stats && !activeSource && (
						<>
							<Badge variant="secondary" className="gap-1">
								<Package size={11} />{" "}
								{t("workspace.statInDb", { count: stats.totalInDb })}
							</Badge>
							<Badge variant="secondary" className="gap-1">
								<Layers size={11} />{" "}
								{t("workspace.statInCatalog", { count: stats.inCatalog })}
							</Badge>
							<Badge
								variant="secondary"
								className={cn(
									stats.missingNitro > 0 &&
										"text-[var(--admin-warning)] border-[var(--admin-warning)]/40",
								)}
							>
								<CircleAlert size={11} />{" "}
								{t("workspace.statMissingNitro", { count: stats.missingNitro })}
							</Badge>
						</>
					)}
					{cloneStats && activeSource && (
						<>
							<Badge variant="secondary" className="gap-1">
								<Package size={11} />{" "}
								{t("workspace.statTotal", { count: cloneStats.total })}
							</Badge>
							<Badge variant="secondary" className="gap-1">
								<Check size={11} className="text-[var(--admin-success)]" />{" "}
								{t("workspace.statPresent", { count: cloneStats.present })}
							</Badge>
							{cloneStats.clonable > 0 && (
								<Badge
									variant="secondary"
									className="gap-1 text-[var(--admin-accent)] border-[var(--admin-accent)]/40"
								>
									<CloudDownload size={11} />{" "}
									{t("workspace.statToImport", {
										count: cloneStats.clonable,
									})}
								</Badge>
							)}
						</>
					)}
				</div>
			</header>

			{/* ── Filters + actions ─────────────────────────────── */}
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 sm:px-4">
				<button
					type="button"
					onClick={() => setRailOpen((v) => !v)}
					aria-label={
						railOpen ? t("aria.hideCatalogTree") : t("aria.showCatalogTree")
					}
					title={
						railOpen ? t("aria.hideCatalogTree") : t("aria.showCatalogTree")
					}
					className={cn(
						"flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
						railOpen
							? "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)]"
							: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
					)}
				>
					{railOpen ? (
						<PanelLeftClose size={13} />
					) : (
						<PanelLeftOpen size={13} />
					)}
					{t("workspace.catalog")}
				</button>

				<Select
					value={activeSource}
					onValueChange={changeSource}
					disabled={preparingReview}
				>
					<SelectTrigger
						aria-label={t("aria.source")}
						className="h-8 w-44 text-xs"
					>
						<SelectValue>
							{sources.find((entry) => entry.id === activeSource)?.name ??
								`${source.label} ${t("workspace.official")}`}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">
							{source.label} {t("workspace.official")}
						</SelectItem>
						{sources.map((s) => (
							<SelectItem key={s.id} value={s.id}>
								{s.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={typeFilter} onValueChange={setTypeFilter}>
					<SelectTrigger
						aria-label={t("aria.type")}
						className="h-8 w-32 text-xs"
					>
						<SelectValue>
							{typeFilter === "all"
								? t("filters.allTypes")
								: typeFilter === "flooritem"
									? t("filters.floorItems")
									: t("filters.wallItems")}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("filters.allTypes")}</SelectItem>
						<SelectItem value="flooritem">{t("filters.floorItems")}</SelectItem>
						<SelectItem value="wallitem">{t("filters.wallItems")}</SelectItem>
					</SelectContent>
				</Select>

				<Select value={categoryFilter} onValueChange={setCategoryFilter}>
					<SelectTrigger
						aria-label={t("aria.category")}
						className="h-8 w-40 text-xs"
					>
						<SelectValue>
							{categoryFilter === "all"
								? t("filters.allCategories")
								: categoryFilter}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{categories.map((cat) => (
							<SelectItem key={cat} value={cat}>
								{cat === "all" ? t("filters.allCategories") : cat}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger
						aria-label={t("aria.status")}
						className="h-8 w-36 text-xs"
					>
						<SelectValue>
							{t(STATUS_LABEL_KEYS[statusFilter] ?? statusFilter)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{notImportedCount > 0
								? t("filters.allStatusesCount", {
										count: notImportedCount,
									})
								: t("filters.allStatuses")}
						</SelectItem>
						<SelectItem value="notImported">
							{t("filters.statuses.notImported")}
						</SelectItem>
						<SelectItem value="imported">
							{t("filters.statuses.imported")}
						</SelectItem>
						<SelectItem value="inCatalog">
							{t("filters.statuses.inCatalog")}
						</SelectItem>
						<SelectItem value="missingNitro">
							{t("filters.statuses.missingNitro")}
						</SelectItem>
						<SelectItem value="missingFurnidata">
							{t("filters.statuses.missingFurnidata")}
						</SelectItem>
						<SelectItem value="missingCatalog">
							{t("filters.statuses.missingCatalog")}
						</SelectItem>
					</SelectContent>
				</Select>

				<Select value={sortBy} onValueChange={changeSortBy}>
					<SelectTrigger
						aria-label={t("aria.sort")}
						className="h-8 w-44 text-xs"
					>
						<ArrowUpDown size={12} className="mr-1" />
						<SelectValue>{t(SORT_LABEL_KEYS[sortBy] ?? sortBy)}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="default">
							{t("filters.sorts.default")}
						</SelectItem>
						<SelectItem value="name">{t("filters.sorts.name")}</SelectItem>
						<SelectItem value="classname">
							{t("filters.sorts.classname")}
						</SelectItem>
						<SelectItem value="category">
							{t("filters.sorts.category")}
						</SelectItem>
						<SelectItem value="imported-first">
							{t("filters.sorts.importedFirst")}
						</SelectItem>
						<SelectItem value="not-imported-first">
							{t("filters.sorts.notImportedFirst")}
						</SelectItem>
					</SelectContent>
				</Select>

				{(typeFilter !== "all" ||
					categoryFilter !== "all" ||
					statusFilter !== "all" ||
					selectedPage !== null) && (
					<Button variant="ghost" size="sm" onClick={clearFilters}>
						{t("filters.reset")}
					</Button>
				)}
				{missingNitroCount > 0 && (
					<button
						type="button"
						onClick={() => setStatusFilter("missingNitro")}
						className={cn(
							"flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
							statusFilter === "missingNitro"
								? "border-[var(--admin-warning)] bg-[var(--admin-warning)]/10 text-[var(--admin-warning)]"
								: "border-[var(--admin-border)] text-[var(--admin-warning)] hover:bg-[var(--admin-warning)]/10",
						)}
					>
						<CircleAlert size={12} />
						{t("filters.noNitro", { count: missingNitroCount })}
					</button>
				)}
				{missingFurnidataCount > 0 && (
					<button
						type="button"
						onClick={() => setStatusFilter("missingFurnidata")}
						className={cn(
							"flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
							statusFilter === "missingFurnidata"
								? "border-[var(--admin-warning)] bg-[var(--admin-warning)]/10 text-[var(--admin-warning)]"
								: "border-[var(--admin-border)] text-[var(--admin-warning)] hover:bg-[var(--admin-warning)]/10",
						)}
					>
						<FileJson2 size={12} />
						{t("filters.noFurnidata", { count: missingFurnidataCount })}
					</button>
				)}

				<div className="flex h-8 items-center overflow-hidden rounded-md border border-[var(--admin-border)]">
					<button
						type="button"
						onClick={() => changeViewMode("grid")}
						aria-label={t("aria.gridView")}
						aria-pressed={viewMode === "grid"}
						className={cn(
							"grid h-8 w-8 place-items-center transition-colors",
							viewMode === "grid"
								? "bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]"
								: "text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10",
						)}
					>
						<LayoutGrid size={13} />
					</button>
					<button
						type="button"
						onClick={() => changeViewMode("list")}
						aria-label={t("aria.listView")}
						aria-pressed={viewMode === "list"}
						className={cn(
							"grid h-8 w-8 place-items-center transition-colors",
							viewMode === "list"
								? "bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]"
								: "text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10",
						)}
					>
						<List size={13} />
					</button>
				</div>
			</div>
			<details className="shrink-0 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 sm:px-4">
				<summary className="cursor-pointer py-1 text-sm font-medium">
					{t("importOptions.summary")}{" "}
					<span className="font-normal text-[var(--admin-text-muted)]">
						·{" "}
						{t(
							translate
								? "importOptions.translationOn"
								: "importOptions.translationOff",
						)}
					</span>
				</summary>
				<div className="flex max-h-48 flex-wrap items-center gap-3 overflow-auto py-3">
					{" "}
					{/* ── Import speed (parallel items per batch) ─────────── */}
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-[var(--admin-text-muted)]">
							{t("importOptions.speed")}
						</span>
						<Select
							value={String(concurrency)}
							onValueChange={(value) =>
								setConcurrency(Math.max(1, Number(value)))
							}
						>
							<SelectTrigger
								aria-label={t("aria.importSpeed")}
								className="h-8 w-24 text-xs"
							>
								<SelectValue>
									{t("importOptions.parallel", { count: concurrency })}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="1">{t("importOptions.gentle")}</SelectItem>
								<SelectItem value="2">2</SelectItem>
								<SelectItem value="4">
									{t("importOptions.recommended")}
								</SelectItem>
								<SelectItem value="6">6</SelectItem>
								<SelectItem value="8">8</SelectItem>
								<SelectItem value="12">{t("importOptions.turbo")}</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{/* ── Translate control (per-import) ─────────────── */}
					<div className="flex items-center gap-2">
						<div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--admin-border)] px-2.5">
							<Switch
								checked={translate}
								onCheckedChange={setTranslate}
								aria-label={t("aria.translateImport")}
							/>
							<span className="text-xs font-medium text-[var(--admin-text-muted)]">
								{t("importOptions.translate")}
							</span>
						</div>

						<Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									className="h-8 gap-1.5"
									disabled={!translate}
								>
									<Languages size={13} />
									{translateLangs.length === 0
										? t("importOptions.noLanguages")
										: translateLangs.length === ALL_LANGS.length
											? t("importOptions.allLanguages")
											: t("importOptions.languagesCount", {
													count: translateLangs.length,
												})}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-60 p-2">
								<div className="mb-2 flex items-center justify-between">
									<span className="text-xs font-semibold text-[var(--admin-text)]">
										{t("importOptions.languages")}
									</span>
									<div className="flex gap-1">
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-[0.65rem]"
											onClick={() => setTranslateLangs([...ALL_LANGS])}
										>
											{t("importOptions.all")}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-[0.65rem]"
											onClick={() => setTranslateLangs([])}
										>
											{t("importOptions.none")}
										</Button>
									</div>
								</div>
								<div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
									{ALL_LANGS.map((lang) => {
										const on = translateLangs.includes(lang);
										return (
											<button
												key={lang}
												type="button"
												onClick={() => toggleLang(lang)}
												className={cn(
													"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
													on
														? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-text)]"
														: "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10",
												)}
											>
												<Checkbox
													style={{
														display: "inline-flex",
														width: 18,
														height: 18,
													}}
													className="border-[var(--admin-border)] bg-[var(--admin-surface)] data-checked:border-[var(--admin-accent)] data-checked:bg-[var(--admin-accent)] data-checked:text-[var(--admin-accent-foreground)]"
													checked={on}
													aria-label={t("aria.languageLabel", { lang })}
													tabIndex={-1}
												/>
												{lang.toUpperCase()}
											</button>
										);
									})}
								</div>
							</PopoverContent>
						</Popover>

						<Button
							variant="outline"
							size="sm"
							className="h-8 gap-1.5"
							disabled={buildingLanguages}
							onClick={buildAllLanguages}
							title={t("importOptions.translateAllTitle")}
						>
							{buildingLanguages ? (
								<Loader2 size={13} className="animate-spin" />
							) : (
								<Globe size={13} />
							)}
							{t("importOptions.translateAll")}
						</Button>
					</div>
					<div className="flex items-center gap-1.5 rounded-md border border-[var(--admin-border)] px-2.5 py-1">
						<Switch
							checked={globalTranslate}
							onCheckedChange={onGlobalTranslateChange}
							aria-label={t("aria.defaultTranslation")}
						/>
						<Globe size={13} className="text-[var(--admin-text-muted)]" />
						<span className="text-xs font-medium text-[var(--admin-text-muted)]">
							{t("importOptions.defaultFuture")}
						</span>
					</div>
				</div>
			</details>
			<fieldset
				aria-label={t("aria.selection")}
				className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 sm:px-4"
			>
				<button
					type="button"
					onClick={toggleAll}
					className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--admin-border)] px-2.5 text-xs font-medium text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)]"
				>
					<CheckboxDot checked={allSelected} />
					{allSelected
						? t("selection.deselectVisible")
						: t("selection.selectVisible")}
				</button>

				{hasMorePages && meta && (
					<button
						type="button"
						onClick={selectAllResults}
						disabled={loadingAll}
						className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5 px-2.5 text-xs font-medium text-[var(--admin-text)] transition-colors hover:bg-[var(--admin-accent)]/10 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{loadingAll ? (
							<Loader2 size={13} className="animate-spin" />
						) : (
							<ListChecks size={13} />
						)}
						{loadingAll
							? t("selection.loadingAll")
							: t("selection.selectAllResults", {
									count: meta.total.toLocaleString(),
								})}
					</button>
				)}

				{selected.size > 0 && (
					<span className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--admin-border)] bg-[var(--admin-accent)]/5 px-2.5 text-xs font-medium text-[var(--admin-text)]">
						{t("selection.selectedInView", {
							count: filteredItems.filter((item) =>
								selected.has(item.classname),
							).length,
						})}
					</span>
				)}

				{selected.size > 0 && (
					<button
						type="button"
						onClick={() => setSelected(new Set())}
						className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--admin-text-muted)] transition-colors hover:text-[var(--admin-warning)]"
					>
						<X size={12} />
						{t("selection.clear")}
					</button>
				)}

				<div className="flex-1" />

				{cloneStats && cloneStats.clonable > 0 && !batchProgress && (
					<Button
						size="sm"
						className="gap-1.5"
						onClick={prepareCloneReview}
						disabled={preparingReview}
					>
						<CloudDownload size={14} />
						{preparingReview
							? t("selection.preparingReview")
							: t("selection.importAllMissing", {
									count: cloneStats.clonable,
								})}
					</Button>
				)}

				{selectedNonImported > 0 && (
					<Button
						size="sm"
						className="gap-1.5"
						disabled={!!batchProgress}
						onClick={() =>
							setReview({
								items: filteredItems.filter((item) =>
									selected.has(item.classname),
								),
								single: false,
							})
						}
					>
						{batchProgress ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<CloudDownload size={14} />
						)}
						{t("selection.importSelected", {
							count: selectedNonImported,
						})}
					</Button>
				)}

				{selectedMissingNitro.length > 0 && !batchProgress && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						disabled={bulkRegenning}
						onClick={bulkRegenNitro}
					>
						{bulkRegenning ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<RefreshCw size={14} />
						)}
						{t("selection.rebuildNitro", {
							count: selectedMissingNitro.length,
						})}
					</Button>
				)}

				{selectedMissingFurnidata.length > 0 && !batchProgress && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						disabled={bulkFurnidata}
						onClick={bulkAddFurnidata}
					>
						{bulkFurnidata ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<FileJson2 size={14} />
						)}
						{t("selection.addMissingFurnidata", {
							count: selectedMissingFurnidata.length,
						})}
					</Button>
				)}

				{selectedImported.length > 0 && !batchProgress && (
					<Button
						size="sm"
						variant="destructive"
						className="gap-1.5"
						disabled={bulkDeleting}
						onClick={bulkDeleteSelected}
					>
						{bulkDeleting ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<Trash2 size={14} />
						)}
						{t("selection.deleteSelected", {
							count: selectedImported.length,
						})}
					</Button>
				)}
			</fieldset>

			{selected.size >
				filteredItems.filter((item) => selected.has(item.classname)).length && (
				<p className="shrink-0 px-4 py-1 text-xs text-[var(--admin-text-muted)]">
					{t("selection.hiddenWarning")}
				</p>
			)}
			{/* ── Body: rail + grid + drawer ────────────────────── */}
			<div className="relative flex min-h-0 flex-1">
				{railOpen && (
					<button
						type="button"
						aria-label={t("aria.closeCategoryPanel")}
						onClick={() => setRailOpen(false)}
						className="absolute inset-0 z-20 bg-[var(--admin-text)]/30 lg:hidden"
					/>
				)}
				{railOpen ? (
					<CatalogRail
						tree={tree}
						selectedId={selectedPage}
						onSelect={(id) => {
							setSelectedPage(id);
							if (!window.matchMedia("(min-width: 1024px)").matches)
								setRailOpen(false);
						}}
						onClose={() => setRailOpen(false)}
					/>
				) : null}

				<main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
					<button
						type="button"
						onClick={() =>
							listRef.current?.scrollTo({ top: 0, behavior: "smooth" })
						}
						aria-label={t("aria.scrollToTop")}
						title={t("aria.scrollToTop")}
						className={cn(
							"absolute bottom-4 right-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)] shadow-lg transition-all hover:text-[var(--admin-text)]",
							showBackToTop
								? "translate-y-0 opacity-100"
								: "pointer-events-none translate-y-2 opacity-0",
						)}
					>
						<ArrowUp size={15} />
					</button>
					<div
						ref={listRef}
						data-testid="studio-furniture-list"
						className="min-h-0 flex-1 overflow-y-auto p-3"
					>
						{loading && items.length === 0 ? (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
								{Array.from({ length: 10 }, (_, i) => i).map((n) => (
									<div
										key={`skeleton-${n}`}
										className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]"
									>
										<div className="h-24 animate-pulse bg-[var(--admin-accent)]/10" />
										<div className="space-y-2 border-t border-[var(--admin-border)] p-2.5">
											<div className="h-3 w-3/4 animate-pulse rounded bg-[var(--admin-accent)]/10" />
											<div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--admin-accent)]/10" />
										</div>
									</div>
								))}
							</div>
						) : error ? (
							<div className="py-16 text-center text-sm text-[var(--admin-warning)]">
								{error}
								<Button
									variant="outline"
									className="ml-3"
									onClick={() => fetchItems(activeSearch, 1, activeSource)}
								>
									{t("items.tryAgain")}
								</Button>
							</div>
						) : filteredItems.length === 0 ? (
							<div className="flex flex-col items-center py-16 text-center">
								<div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
									<Search
										size={22}
										className="text-[var(--admin-text-muted)]"
									/>
								</div>
								<p className="text-sm font-semibold text-[var(--admin-text)]">
									{activeSearch
										? t("items.noFound", { query: activeSearch })
										: t("items.noFurni")}
								</p>
								<p className="mt-1 text-xs text-[var(--admin-text-muted)]">
									{activeSearch
										? t("items.noFoundHint")
										: t("items.noFurniHint")}
								</p>
							</div>
						) : (
							<div key={viewMode} className="studio-list-fade-in">
								{viewMode === "grid" ? (
									<div
										className="relative w-full"
										style={{ height: `${gridVirtualizer.getTotalSize()}px` }}
									>
										{gridVirtualizer.getVirtualItems().map((vi) => {
											const start = vi.index * gridCols;
											const rowItems = filteredItems.slice(
												start,
												start + gridCols,
											);
											return (
												<div
													key={vi.key}
													data-index={vi.index}
													ref={gridVirtualizer.measureElement}
													className="absolute left-0 top-0 w-full will-change-transform"
													style={{ transform: `translateY(${vi.start}px)` }}
												>
													<div
														className="grid gap-3"
														style={{
															gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
														}}
													>
														{rowItems.map((item) => {
															const isSel = selected.has(item.classname);
															return (
																<div
																	key={item.classname}
																	className="group relative"
																>
																	<button
																		type="button"
																		onClick={() => openDetail(item)}
																		className={cn(
																			"flex w-full flex-col overflow-hidden rounded-xl border text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]",
																			isSel
																				? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 ring-2 ring-[var(--admin-accent)]/20"
																				: "border-[var(--admin-border)] bg-[var(--admin-surface)] hover:-translate-y-0.5 hover:border-[var(--admin-accent)]/60 hover:shadow-lg hover:shadow-[var(--admin-accent)]/10",
																		)}
																	>
																		<div
																			className="relative flex h-24 items-center justify-center overflow-hidden"
																			style={{
																				backgroundImage:
																					"radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--admin-text-muted) 14%, transparent) 1px, transparent 0)",
																				backgroundSize: "14px 14px",
																			}}
																		>
																			<div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[var(--admin-text)]/5 to-transparent" />
																			<img
																				src={getFurniImageUrl(item)}
																				alt={item.name}
																				className="h-14 w-14 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform duration-200 group-hover:scale-110"
																				style={{ imageRendering: "pixelated" }}
																				loading="lazy"
																				decoding="async"
																				onError={(e) => handleImgError(e, item)}
																			/>
																		</div>
																		<div className="flex items-start justify-between gap-1 border-t border-[var(--admin-border)] px-2 py-1.5">
																			<div className="min-w-0">
																				<p className="truncate text-xs font-semibold text-[var(--admin-text)]">
																					<Highlighted
																						text={item.name}
																						query={activeSearch}
																					/>
																				</p>
																				<p className="truncate font-mono text-[0.6rem] text-[var(--admin-text-muted)]">
																					<Highlighted
																						text={item.classname}
																						query={activeSearch}
																					/>
																				</p>
																				<p className="truncate text-[0.6rem] text-[var(--admin-text-muted)]/80">
																					{item.category || "—"}
																				</p>
																			</div>
																		</div>
																		<div className="flex items-center gap-1 px-2 pb-1.5">
																			<Badge className="h-4 bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]">
																				{typeLabel(item.type)}
																			</Badge>
																			{item.alreadyImported ? (
																				<>
																					{!item.nitroExists && (
																						<Badge
																							variant="secondary"
																							className="h-4 text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																						>
																							{t("items.noNitro")}
																						</Badge>
																					)}
																					{item.hasFurnidata === false && (
																						<Badge
																							variant="secondary"
																							className="h-4 text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																						>
																							{t("items.noFurnidata")}
																						</Badge>
																					)}
																					{item.hasCatalogEntry === false && (
																						<Badge
																							variant="secondary"
																							className="h-4 text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																						>
																							{t("items.noCatalog")}
																						</Badge>
																					)}
																					{item.nitroExists &&
																						item.hasFurnidata !== false &&
																						item.hasCatalogEntry !== false && (
																							<Badge
																								variant="secondary"
																								className="h-4 text-[var(--admin-success)] border-[var(--admin-success)]/40"
																							>
																								{t("items.imported")}
																							</Badge>
																						)}
																				</>
																			) : (
																				<Badge className="h-4 bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]">
																					{t("items.new")}
																				</Badge>
																			)}
																		</div>
																	</button>
																	<button
																		type="button"
																		onClick={(e) => {
																			e.stopPropagation();
																			toggleSelect(item.classname);
																		}}
																		className={cn(
																			"absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md border transition-all",
																			isSel
																				? "scale-105 border-[var(--admin-accent)] bg-[var(--admin-accent)] shadow-md shadow-[var(--admin-accent)]/30"
																				: "border-[var(--admin-border)] bg-[var(--admin-surface)] opacity-70 hover:border-[var(--admin-accent)]/60 hover:opacity-100",
																		)}
																		aria-label={
																			isSel
																				? t("aria.deselectItem", {
																						name: item.name,
																					})
																				: t("aria.selectItem", {
																						name: item.name,
																					})
																		}
																		aria-pressed={isSel}
																	>
																		{isSel ? (
																			<Check
																				size={12}
																				className="text-[var(--admin-accent-foreground)]"
																			/>
																		) : null}
																	</button>
																</div>
															);
														})}
													</div>
												</div>
											);
										})}
									</div>
								) : (
									<table
										aria-label={t("aria.results")}
										className="w-full text-sm"
										style={{ borderCollapse: "separate" }}
									>
										<thead>
											<tr
												className="sticky top-0 z-10 grid w-full min-w-[660px] border-b border-[var(--admin-border)] bg-[var(--admin-surface)]"
												style={{ gridTemplateColumns: TABLE_COLS }}
											>
												<th scope="col" className="px-2 py-2 text-left">
													<Checkbox
														style={{
															display: "inline-flex",
															width: 18,
															height: 18,
														}}
														className="border-[var(--admin-border)] bg-[var(--admin-surface)] data-checked:border-[var(--admin-accent)] data-checked:bg-[var(--admin-accent)] data-checked:text-[var(--admin-accent-foreground)]"
														checked={allSelected}
														onCheckedChange={toggleAll}
														aria-label={t("aria.selectAll")}
													/>
												</th>
												<th scope="col" className="px-1 py-2" />
												<th
													scope="col"
													className="px-2 py-2 text-left font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colName")}
												</th>
												<th
													scope="col"
													className="px-2 py-2 text-left font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colClassname")}
												</th>
												<th
													scope="col"
													className="px-2 py-2 text-left font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colType")}
												</th>
												<th
													scope="col"
													className="px-2 py-2 text-left font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colCategory")}
												</th>
												<th
													scope="col"
													className="px-2 py-2 text-left font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colStatus")}
												</th>
												<th
													scope="col"
													className="px-2 py-2 text-right font-semibold text-[var(--admin-text-muted)]"
												>
													{t("items.colActions")}
												</th>
											</tr>
										</thead>
										<tbody
											className="relative w-full"
											style={{
												display: "block",
												height: `${tableVirtualizer.getTotalSize()}px`,
											}}
										>
											{tableVirtualizer.getVirtualItems().map((vi) => {
												const item = filteredItems[vi.index];
												const isSel = selected.has(item.classname);
												return (
													<tr
														key={vi.key}
														data-index={vi.index}
														ref={tableVirtualizer.measureElement}
														aria-selected={isSel}
														className={cn(
															"absolute left-0 top-0 grid w-full min-w-[660px] text-sm transition-colors hover:bg-[var(--admin-accent)]/5",
															vi.index % 2 === 1 &&
																"bg-[var(--admin-text)]/[0.03]",
															isSel &&
																"bg-[var(--admin-accent)]/10 shadow-[inset_2px_0_0_0_var(--admin-accent)]",
														)}
														style={{
															display: "grid",
															transform: `translateY(${vi.start}px)`,
															gridTemplateColumns: TABLE_COLS,
														}}
													>
														<td className="border-t border-[var(--admin-border)] px-2 py-1.5">
															<Checkbox
																style={{
																	display: "inline-flex",
																	width: 18,
																	height: 18,
																}}
																className="border-[var(--admin-border)] bg-[var(--admin-surface)] data-checked:border-[var(--admin-accent)] data-checked:bg-[var(--admin-accent)] data-checked:text-[var(--admin-accent-foreground)]"
																checked={isSel}
																onCheckedChange={() =>
																	toggleSelect(item.classname)
																}
																aria-label={t("aria.selectItem", {
																	name: item.classname,
																})}
															/>
														</td>
														<td className="border-t border-[var(--admin-border)] px-1 py-1.5">
															<button
																type="button"
																onClick={() => openDetail(item)}
																className="rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
																aria-label={t("aria.viewItem", {
																	name: item.name,
																})}
															>
																<img
																	src={getFurniImageUrl(item)}
																	alt=""
																	decoding="async"
																	className="h-8 w-8 object-contain"
																	style={{ imageRendering: "pixelated" }}
																	loading="lazy"
																	onError={(e) => handleImgError(e, item)}
																/>
															</button>
														</td>
														<td className="truncate border-t border-[var(--admin-border)] px-2 py-1.5 font-medium text-[var(--admin-text)]">
															<Highlighted
																text={item.name}
																query={activeSearch}
															/>
														</td>
														<td className="truncate border-t border-[var(--admin-border)] px-2 py-1.5 font-mono text-[0.7rem] text-[var(--admin-text-muted)]">
															<Highlighted
																text={item.classname}
																query={activeSearch}
															/>
														</td>
														<td className="truncate border-t border-[var(--admin-border)] px-2 py-1.5 text-[var(--admin-text-muted)]">
															{typeLabel(item.type)}
														</td>
														<td className="truncate border-t border-[var(--admin-border)] px-2 py-1.5 text-[var(--admin-text-muted)]">
															{item.category || "—"}
														</td>
														<td className="border-t border-[var(--admin-border)] px-2 py-1.5">
															{item.alreadyImported ? (
																<div className="flex flex-wrap gap-0.5">
																	{!item.nitroExists && (
																		<Badge
																			variant="secondary"
																			className="h-4 text-[0.6rem] text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																		>
																			{t("items.noNitro")}
																		</Badge>
																	)}
																	{item.hasFurnidata === false && (
																		<Badge
																			variant="secondary"
																			className="h-4 text-[0.6rem] text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																		>
																			{t("items.noFurnidata")}
																		</Badge>
																	)}
																	{item.hasCatalogEntry === false && (
																		<Badge
																			variant="secondary"
																			className="h-4 text-[0.6rem] text-[var(--admin-warning)] border-[var(--admin-warning)]/40"
																		>
																			{t("items.noCatalog")}
																		</Badge>
																	)}
																	{item.nitroExists &&
																		item.hasFurnidata !== false &&
																		item.hasCatalogEntry !== false && (
																			<Badge
																				variant="secondary"
																				className="h-4 text-[0.6rem] text-[var(--admin-success)] border-[var(--admin-success)]/40"
																			>
																				{t("items.imported")}
																			</Badge>
																		)}
																</div>
															) : (
																<Badge className="h-4 bg-[var(--admin-accent)] text-[var(--admin-accent-foreground)]">
																	{t("items.new")}
																</Badge>
															)}
														</td>
														<td className="border-t border-[var(--admin-border)] px-2 py-1.5">
															<div className="flex items-center justify-end gap-1">
																{!item.alreadyImported && (
																	<button
																		type="button"
																		onClick={() =>
																			setReview({
																				items: [item],
																				single: true,
																			})
																		}
																		disabled={importingId !== null}
																		aria-label={t("aria.importItem", {
																			name: item.classname,
																		})}
																		className="grid h-9 w-9 place-items-center rounded-md text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)] disabled:opacity-50"
																	>
																		{importingId === item.classname ? (
																			<Loader2
																				size={12}
																				className="animate-spin"
																			/>
																		) : (
																			<CloudDownload size={12} />
																		)}
																	</button>
																)}
																{item.alreadyImported && item.nitroExists && (
																	<button
																		type="button"
																		onClick={() =>
																			setEditingClassname(item.classname)
																		}
																		aria-label={t("aria.editNitro", {
																			name: item.classname,
																		})}
																		className="grid h-9 w-9 place-items-center rounded-md text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-text)]"
																	>
																		<Pencil size={12} />
																	</button>
																)}
																{item.alreadyImported && !item.nitroExists && (
																	<button
																		type="button"
																		onClick={() => regenNitro(item)}
																		disabled={regeneratingNitro.has(
																			item.classname,
																		)}
																		aria-label={t("aria.regenerateNitro", {
																			name: item.classname,
																		})}
																		className="grid h-9 w-9 place-items-center rounded-md text-[var(--admin-warning)] transition-colors hover:bg-[var(--admin-warning)]/10 disabled:opacity-50"
																	>
																		{regeneratingNitro.has(item.classname) ? (
																			<Loader2
																				size={12}
																				className="animate-spin"
																			/>
																		) : (
																			<RefreshCw size={12} />
																		)}
																	</button>
																)}
															</div>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								)}

								<div
									ref={sentinelRef}
									className="mt-4 flex flex-col items-center justify-center gap-2 py-2 text-xs text-[var(--admin-text-muted)]"
								>
									{hasMorePages ? (
										loading ? (
											<span className="flex items-center gap-2">
												<Loader2
													size={14}
													className="animate-spin text-[var(--admin-accent)]"
												/>
												{t("items.loadingMore")}
											</span>
										) : (
											<span className="flex items-center gap-2">
												<ArrowDown size={12} />
												{t("items.scrollForMore")}
											</span>
										)
									) : (
										<span className="flex items-center gap-2">
											<span className="h-px w-8 bg-[var(--admin-border)]" />
											{t("items.endOfResults")}
											<span className="h-px w-8 bg-[var(--admin-border)]" />
										</span>
									)}
								</div>
							</div>
						)}
					</div>

					{batchProgress ? (
						<BatchProgress
							progress={batchProgress}
							done={batchDone}
							succeeded={batchSucceeded}
							failed={batchFailed}
							cancelling={batchCancelling || cloneAllCancelling}
							verification={verification}
							startTime={batchStartTimeRef.current || undefined}
							failedClassnames={
								failedClassnames.length > 0 ? failedClassnames : undefined
							}
							onCancel={cloneAllAbortRef.current ? cancelCloneAll : cancelBatch}
							onDismiss={() => {
								setBatchProgress(null);
								batchDoneRef.current = false;
								setBatchDone(false);
								setVerification(null);
								setFailedClassnames([]);
							}}
							onRetry={retryFailed}
						/>
					) : null}
				</main>

				{/* ── Detail drawer ─────────────────────────────── */}
				{detail ? (
					<Suspense
						fallback={
							<StudioPanelLoading drawer onClose={() => setDetail(null)} />
						}
					>
						<FurnitureDetailDrawer
							detail={detail}
							importingId={importingId}
							regenerating={regeneratingNitro.has(detail.classname)}
							inspectionKey={`${detail.classname}-${detail.alreadyImported}-${jobs.jobs
								.filter(
									(j) =>
										j.state === "completed" ||
										j.state === "cancelled" ||
										j.state === "interrupted",
								)
								.map((j) => j.id)
								.join(",")}`}
							busy={
								jobs.busy ||
								jobs.jobs.some(
									(j) =>
										(j.state === "queued" || j.state === "running") &&
										j.items.some((i) => i.classname === detail.classname),
								)
							}
							onClose={() => setDetail(null)}
							onImport={() => setReview({ items: [detail], single: true })}
							onEdit={() => setEditingClassname(detail.classname)}
							onRegenerate={() => void regenNitro(detail)}
							onDelete={() => {
								setDeleting(detail.classname);
								setConfirmDelete(true);
							}}
							onRepair={() =>
								jobs.submit([detail], {
									sourceId: activeSource || undefined,
									translate: false,
									mode: "repair",
								})
							}
						/>
					</Suspense>
				) : null}
			</div>

			{review && (
				<Suspense
					fallback={<StudioPanelLoading onClose={() => setReview(null)} />}
				>
					<ImportReview
						items={review.items}
						sourceId={activeSource || undefined}
						source={
							sources.find((entry) => entry.id === activeSource)?.name ??
							source.label
						}
						translation={
							translate
								? translateLangs.length
									? translateLangs.join(", ")
									: t("items.defaultLanguages")
								: t("items.off")
						}
						onCancel={() => setReview(null)}
						busy={jobs.busy}
						onConfirm={async (accepted) => {
							if (
								await jobs.submit(accepted, {
									sourceId: activeSource || undefined,
									translate,
									langs: translateLangs.length ? translateLangs : undefined,
								})
							) {
								setReview(null);
								setSelected(new Set());
							}
						}}
					/>
				</Suspense>
			)}
			{editingClassname !== null && (
				<Suspense
					fallback={
						<StudioPanelLoading onClose={() => setEditingClassname(null)} />
					}
				>
					<NitroEditorDialog
						classname={editingClassname ?? ""}
						name={detail?.name ?? ""}
						open={editingClassname !== null}
						onOpenChange={(open) => !open && setEditingClassname(null)}
					/>
				</Suspense>
			)}

			{confirmDialog}

			<Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("deleteDialog.title")}</DialogTitle>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">
						{t("deleteDialog.body", { name: deleting ?? "" })}
					</p>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDelete(false)}>
							{t("deleteDialog.cancel")}
						</Button>
						<Button
							variant="destructive"
							className="gap-1.5"
							onClick={deleteItem}
							disabled={!deleting}
						>
							<Trash2 size={14} />
							{t("deleteDialog.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
