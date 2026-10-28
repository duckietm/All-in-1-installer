"use client";

import {
	AlertTriangle,
	ArrowRight,
	Eye,
	Folder,
	FolderTree,
	Home,
	LayoutGrid,
	Loader2,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	Undo2,
	Wand2,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type OrganizedPageChange,
	type OrganizeImportGroup as OrganizeGroupPayload,
	organizeImportFurni,
} from "@/actions/catalog";
import { IconPicker } from "@/components/admin/catalog/icon-picker";
import { CatalogIcon, LAYOUT_COLORS } from "@/components/admin/catalog-tree";
import type {
	OrganizeImportGroup,
	OrganizeImportItem,
} from "@/components/admin/studio/organize-imports-dialog/mall-helpers";
import {
	GroupItemList,
	LayoutPreview,
} from "@/components/admin/studio/organize-imports-dialog/mall-helpers";
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
import { applyCatalogDelta } from "@/features/catalog/client/use-live-catalog";
import { logger } from "@/lib/browser-log";
import {
	CATALOG_LAYOUTS,
	type CatalogLayout,
	isValidCatalogLayout,
	LAYOUT_DESCRIPTIONS,
} from "@/lib/catalog-layouts";
import { cn } from "@/lib/utils";

const MAX_ITEMS_PER_RUN = 500;
const MAX_GROUPS_PER_RUN = 50;
const QUICK_PICKS = 40;
const DAYS_OPTIONS = [30, 60, 90, 180] as const;

const LS_KEY = "epicnexst:organizePrefs";
const HIST_KEY = "epicnexst:organizeHistory";

interface OrganizePrefs {
	moveMode?: boolean;
	parentId?: number;
	freeMode?: boolean;
	credits?: number;
	points?: number;
	pointsType?: number;
	days?: number;
	destinationPageId?: number | null;
	destinationCaption?: string | null;
}

function readPrefs(): OrganizePrefs {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(LS_KEY);
		if (raw) return JSON.parse(raw) as OrganizePrefs;
	} catch {
		// ignore storage errors
	}
	return {};
}

interface OrganizeGroupOverride {
	caption?: string;
	icon?: number;
	layout?: CatalogLayout;
}

interface RootPage {
	id: number;
	caption: string;
}

type MoveEntry =
	| { kind: "item"; item: OrganizeImportItem; from: string; to: string }
	| {
			kind: "batch";
			items: OrganizeImportItem[];
			from: Record<string, OrganizeImportItem[]>;
			to: string;
	  };

/** Restore a previously persisted undo history, dropping corrupted entries. */
function readHistory(): MoveEntry[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(HIST_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is MoveEntry => {
			if (!entry || typeof entry !== "object") return false;
			const e = entry as Partial<MoveEntry>;
			if (e.kind === "item") {
				return (
					typeof e.from === "string" &&
					typeof e.to === "string" &&
					e.item != null &&
					typeof e.item.itemId === "number"
				);
			}
			if (e.kind === "batch") {
				return (
					typeof e.to === "string" &&
					e.from != null &&
					typeof e.from === "object" &&
					Array.isArray(e.items)
				);
			}
			return false;
		});
	} catch {
		// ignore corrupt storage
	}
	return [];
}

interface OrganizeImportsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function OrganizeImportsDialog({
	open,
	onOpenChange,
}: OrganizeImportsDialogProps) {
	const t = useTranslations("pages.admin.catalog.workspace.organizeImports");

	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState(false);
	const [groups, setGroups] = useState<OrganizeImportGroup[]>([]);
	const [rootPages, setRootPages] = useState<RootPage[]>([]);
	const [importRootPageId, setImportRootPageId] = useState<number | null>(null);
	const [importRootCaption, setImportRootCaption] = useState<string | null>(
		null,
	);

	const [parentId, setParentId] = useState(-1);
	const [moveMode, setMoveMode] = useState(false);
	const [destinationPageId, setDestinationPageId] = useState<number | null>(
		null,
	);
	const [destinationCaption, setDestinationCaption] = useState<string | null>(
		null,
	);
	const [destQuery, setDestQuery] = useState("");
	const [destDebounced, setDestDebounced] = useState("");
	const [destResults, setDestResults] = useState<RootPage[]>([]);
	const [destSearchLoading, setDestSearchLoading] = useState(false);
	const [destDupes, setDestDupes] = useState<Set<string>>(new Set());
	const [destDupesLoading, setDestDupesLoading] = useState(false);
	const [approved, setApproved] = useState<Record<string, boolean>>({});
	const [overrides, setOverrides] = useState<
		Record<string, OrganizeGroupOverride>
	>({});
	const [previewGroup, setPreviewGroup] = useState<OrganizeImportGroup | null>(
		null,
	);
	const [isCreating, setIsCreating] = useState(false);

	const [freeMode, setFreeMode] = useState(true);
	const [credits, setCredits] = useState(0);
	const [points, setPoints] = useState(0);
	const [pointsType, setPointsType] = useState(0);
	const [groupSearchQuery, setGroupSearchQuery] = useState("");
	const [onlyUnplaced, setOnlyUnplaced] = useState(false);
	const [batchLayout, setBatchLayout] = useState<CatalogLayout>("default_3x3");
	const [batchPrefix, setBatchPrefix] = useState("");
	const [days, setDays] = useState<number>(30);

	const [selection, setSelection] = useState<Set<number>>(new Set());
	const [history, setHistory] = useState<MoveEntry[]>([]);
	const [drag, setDrag] = useState<{
		item: OrganizeImportItem;
		from: string;
	} | null>(null);
	const [hoverGroup, setHoverGroup] = useState<string | null>(null);

	const load = useCallback(async (rangeDays: number) => {
		setLoading(true);
		setLoadError(false);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 45000);
		try {
			const [data, tree] = await Promise.all([
				fetch(`/cms_api/admin/import/organize?days=${rangeDays}`, {
					signal: controller.signal,
				}).then((r) => r.json()),
				fetch("/cms_api/admin/catalog/tree?parentId=-1", {
					signal: controller.signal,
				}).then((r) => r.json()),
			]);
			setGroups(Array.isArray(data?.groups) ? data.groups : []);
			setImportRootPageId(data?.importRootPageId ?? null);
			setImportRootCaption(data?.importRootCaption ?? null);
			const pages = Array.isArray(tree?.pages) ? tree.pages : [];
			const loadedRoots: RootPage[] = pages.map(
				(p: { id: number; caption: string }) => ({
					id: Number(p.id),
					caption: String(p.caption ?? p.id),
				}),
			);
			setRootPages(loadedRoots);
			// Restore a persisted destination only if it still exists.
			const prefs = readPrefs();
			if (prefs.moveMode) {
				setMoveMode(true);
				if (
					prefs.destinationPageId != null &&
					loadedRoots.some((p) => p.id === prefs.destinationPageId)
				) {
					setDestinationPageId(prefs.destinationPageId);
					setDestinationCaption(prefs.destinationCaption ?? null);
				}
			}
		} catch (error) {
			logger.error("[OrganizeImports] load failed", {
				err: error as Error,
			});
			setLoadError(true);
			setGroups([]);
		} finally {
			clearTimeout(timeout);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		const prefs = readPrefs();
		setGroups([]);
		setApproved({});
		setOverrides({});
		setSelection(new Set());
		setHistory(readHistory());
		setDrag(null);
		setHoverGroup(null);
		setParentId(prefs.parentId ?? -1);
		setMoveMode(false);
		setDestinationPageId(null);
		setDestinationCaption(null);
		setDestQuery("");
		setDestDebounced("");
		setDestResults([]);
		setDestDupes(new Set());
		setFreeMode(prefs.freeMode ?? true);
		setCredits(prefs.credits ?? 0);
		setPoints(prefs.points ?? 0);
		setPointsType(prefs.pointsType ?? 0);
		setDays(
			DAYS_OPTIONS.includes(prefs.days as (typeof DAYS_OPTIONS)[number])
				? (prefs.days as number)
				: 30,
		);
		void load(
			DAYS_OPTIONS.includes(prefs.days as (typeof DAYS_OPTIONS)[number])
				? (prefs.days as number)
				: 30,
		);
	}, [open, load]);

	// Persist working settings on every change.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const prefs: OrganizePrefs = {
			moveMode,
			parentId,
			freeMode,
			credits,
			points,
			pointsType,
			days,
			destinationPageId,
			destinationCaption,
		};
		try {
			window.localStorage.setItem(LS_KEY, JSON.stringify(prefs));
		} catch {
			// ignore quota / privacy-mode write errors
		}
	}, [
		moveMode,
		parentId,
		freeMode,
		credits,
		points,
		pointsType,
		days,
		destinationPageId,
		destinationCaption,
	]);

	// Persist the undo history so moves survive closing and reopening the dialog.
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(HIST_KEY, JSON.stringify(history));
		} catch {
			// ignore quota / privacy-mode write errors
		}
	}, [history]);

	useEffect(() => {
		const t = setTimeout(() => setDestDebounced(destQuery.trim()), 300);
		return () => clearTimeout(t);
	}, [destQuery]);

	useEffect(() => {
		if (!moveMode || destDebounced.length < 2) {
			if (!moveMode) setDestResults([]);
			return;
		}
		setDestSearchLoading(true);
		const ac = new AbortController();
		fetch(
			`/cms_api/admin/catalog/tree?search=${encodeURIComponent(destDebounced)}`,
			{ signal: ac.signal },
		)
			.then((r) => r.json())
			.then((data) => {
				const pages = Array.isArray(data?.pages) ? data.pages : [];
				setDestResults(
					pages
						.filter((p: { id: number }) => Number(p.id) > 0)
						.map((p: { id: number; caption: string }) => ({
							id: Number(p.id),
							caption: String(p.caption ?? p.id),
						})),
				);
			})
			.catch((error) =>
				logger.error("[OrganizeImports] page search failed", {
					err: error as Error,
				}),
			)
			.finally(() => setDestSearchLoading(false));
		return () => ac.abort();
	}, [moveMode, destDebounced]);

	// Duplicate detection against the chosen destination page.
	useEffect(() => {
		if (!moveMode || destinationPageId == null) {
			setDestDupes(new Set());
			return;
		}
		const ac = new AbortController();
		setDestDupesLoading(true);
		fetch(`/cms_api/admin/catalog/items?pageId=${destinationPageId}`, {
			signal: ac.signal,
		})
			.then((r) => r.json())
			.then((data) => {
				const items = Array.isArray(data?.items) ? data.items : [];
				setDestDupes(
					new Set(
						items
							.map((i: { baseItemName?: string | null }) =>
								String(i.baseItemName ?? ""),
							)
							.filter(Boolean),
					),
				);
			})
			.catch(() => setDestDupes(new Set()))
			.finally(() => setDestDupesLoading(false));
		return () => ac.abort();
	}, [moveMode, destinationPageId]);

	const allApproved =
		groups.length > 0 && groups.every((g) => approved[g.name] !== false);
	const totalSelected = useMemo(
		() =>
			groups.reduce(
				(sum, g) => sum + (approved[g.name] !== false ? g.items.length : 0),
				0,
			),
		[groups, approved],
	);

	// One approved group becomes exactly one page, so the "Create … pages"
	// label must count groups, not the furni items inside them.
	const selectedGroupsCount = useMemo(
		() => groups.filter((g) => approved[g.name] !== false).length,
		[groups, approved],
	);

	const totalDuplicates = useMemo(() => {
		if (destDupes.size === 0) return 0;
		let count = 0;
		for (const g of groups) {
			if (approved[g.name] === false) continue;
			for (const item of g.items) {
				if (destDupes.has(item.itemName)) count++;
			}
		}
		return count;
	}, [groups, approved, destDupes]);

	const parentOptions = useMemo(() => {
		const options: RootPage[] = [];
		for (const p of rootPages) {
			if (importRootPageId != null && p.id === importRootPageId) continue;
			options.push(p);
		}
		return options;
	}, [rootPages, importRootPageId]);

	const toggleAll = () => {
		const next = !allApproved;
		setApproved(Object.fromEntries(groups.map((g) => [g.name, next])));
	};

	const updateGroup = (name: string, patch: OrganizeGroupOverride) => {
		setOverrides((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
	};

	const applyBatchLayout = (layout: CatalogLayout) => {
		setOverrides((prev) => {
			const next = { ...prev };
			for (const g of groups) {
				if (approved[g.name] !== false) {
					next[g.name] = { ...next[g.name], layout };
				}
			}
			return next;
		});
	};

	const applyBatchPrefix = () => {
		if (!batchPrefix.trim()) return;
		setOverrides((prev) => {
			const next = { ...prev };
			for (const g of groups) {
				if (approved[g.name] !== false) {
					const currentCaption = next[g.name]?.caption ?? g.name;
					if (!currentCaption.startsWith(batchPrefix)) {
						next[g.name] = {
							...next[g.name],
							caption: `${batchPrefix}${currentCaption}`,
						};
					}
				}
			}
			return next;
		});
	};

	const resetAllOverrides = () => {
		setOverrides({});
		setApproved(Object.fromEntries(groups.map((g) => [g.name, true])));
	};

	const filteredGroups = useMemo(() => {
		const q = groupSearchQuery.trim().toLowerCase();
		return groups.filter((g) => {
			const movedCount = g.items.filter((i) => i.alreadyPlaced).length;
			const addedCount = g.items.length - movedCount;
			if (onlyUnplaced && addedCount === 0 && movedCount === 0) return false;
			if (!q) return true;
			if (g.name.toLowerCase().includes(q)) return true;
			const caption = overrides[g.name]?.caption?.toLowerCase();
			if (caption?.includes(q)) return true;
			return g.items.some((i) => i.itemName.toLowerCase().includes(q));
		});
	}, [groups, groupSearchQuery, onlyUnplaced, overrides]);

	const pushHistory = (entry: MoveEntry) => {
		setHistory((prev) => [...prev, entry]);
	};

	const applyMove = (item: OrganizeImportItem, from: string, to: string) => {
		setGroups((prev) =>
			prev.map((g) => {
				if (g.name === from) {
					return {
						...g,
						items: g.items.filter((i) => i.itemId !== item.itemId),
					};
				}
				if (g.name === to) {
					const exists = g.items.some((i) => i.itemId === item.itemId);
					return exists ? g : { ...g, items: [...g.items, item] };
				}
				return g;
			}),
		);
	};

	const moveItemToGroup = (
		item: OrganizeImportItem,
		from: string,
		to: string,
	) => {
		if (!to || to === from) return;
		applyMove(item, from, to);
		pushHistory({ kind: "item", item, from, to });
	};

	const moveSelectedToGroup = (toName: string) => {
		if (selection.size === 0 || !toName) return;
		const movedByGroup: Record<string, OrganizeImportItem[]> = {};
		const next = groups.map((g) => {
			if (g.name === toName) return g;
			const taken = g.items.filter((i) => selection.has(i.itemId));
			const kept = g.items.filter((i) => !selection.has(i.itemId));
			if (taken.length > 0) movedByGroup[g.name] = taken;
			return taken.length === 0 ? g : { ...g, items: kept };
		});
		const moved = Object.values(movedByGroup).flat();
		if (moved.length === 0) return;
		setGroups(
			next.map((g) =>
				g.name === toName ? { ...g, items: [...g.items, ...moved] } : g,
			),
		);
		pushHistory({
			kind: "batch",
			items: moved,
			from: movedByGroup,
			to: toName,
		});
		setSelection(new Set());
	};

	const undo = () => {
		if (history.length === 0) return;
		const last = history[history.length - 1];
		if (last.kind === "item") {
			applyMove(last.item, last.to, last.from);
		} else {
			const fromGroups = last.from;
			setGroups((prev) =>
				prev.map((g) => {
					if (g.name === last.to) {
						const remove = new Set(last.items.map((i) => i.itemId));
						return {
							...g,
							items: g.items.filter((i) => !remove.has(i.itemId)),
						};
					}
					const toRestore = fromGroups[g.name];
					if (toRestore) {
						const existing = new Set(g.items.map((i) => i.itemId));
						const missing = toRestore.filter((i) => !existing.has(i.itemId));
						return missing.length === 0
							? g
							: { ...g, items: [...g.items, ...missing] };
					}
					return g;
				}),
			);
		}
		setHistory((prev) => prev.slice(0, -1));
	};

	const moveItemOptions = (fromName: string) =>
		groups.filter((g) => g.name !== fromName);

	const changeDays = (value: number) => {
		setDays(value);
		void load(value);
	};

	/** Split approved groups into runs that respect the 500-item / 50-group caps. */
	const chunkGroups = (payload: OrganizeGroupPayload[]) => {
		const chunks: OrganizeGroupPayload[][] = [];
		let current: OrganizeGroupPayload[] = [];
		let currentItems = 0;
		const flush = () => {
			if (current.length > 0) {
				chunks.push(current);
				current = [];
				currentItems = 0;
			}
		};
		for (const group of payload) {
			if (group.items.length === 0) continue;
			if (current.length >= MAX_GROUPS_PER_RUN) flush();
			// A single oversized group is split into multiple sequential groups
			// with the same destination (move mode) or a " (2)" suffix (create mode).
			if (group.items.length > MAX_ITEMS_PER_RUN) {
				flush();
				for (
					let start = 0;
					start < group.items.length;
					start += MAX_ITEMS_PER_RUN
				) {
					const part = group.items.slice(start, start + MAX_ITEMS_PER_RUN);
					const partIndex = Math.floor(start / MAX_ITEMS_PER_RUN);
					chunks.push([
						{
							...group,
							caption:
								group.destinationPageId != null || partIndex === 0
									? group.caption
									: `${group.caption} (${partIndex + 1})`,
							items: part,
						},
					]);
				}
				continue;
			}
			if (
				currentItems + group.items.length > MAX_ITEMS_PER_RUN &&
				current.length > 0
			) {
				flush();
			}
			current.push(group);
			currentItems += group.items.length;
			if (currentItems >= MAX_ITEMS_PER_RUN) flush();
		}
		flush();
		return chunks;
	};

	const handleCreate = async () => {
		if (isCreating) return;
		// De-duplicate reads: don't run while nothing is approved.
		if (totalSelected === 0) {
			toast.error(t("errorNoName"));
			return;
		}
		if (groups.length === 0) return;
		if (moveMode && destinationPageId == null) {
			toast.error(t("chooseDestination"));
			return;
		}
		const payload = groups
			.filter((g) => approved[g.name] !== false)
			.map((g) => {
				const o = overrides[g.name] ?? {};
				return {
					caption: moveMode
						? (destinationCaption ?? "Imported")
						: (o.caption ?? g.name).trim(),
					pageLayout: o.layout ?? g.layout ?? "default_3x3",
					iconImage: o.icon ?? g.icon,
					destinationPageId: moveMode ? destinationPageId : null,
					items: g.items.map((item) => ({
						itemId: item.itemId,
						catalogItemId: item.catalogItemId,
						credits: freeMode ? 0 : credits,
						points: freeMode ? 0 : points,
						pointsType: freeMode ? 0 : pointsType,
						amount: 1,
					})),
				};
			});

		if (payload.length === 0 || payload.some((g) => !g.caption)) {
			toast.error(t("errorNoName"));
			return;
		}

		const runs = chunkGroups(payload);
		setIsCreating(true);
		try {
			const created: OrganizedPageChange[] = [];
			let failedRuns = 0;
			for (const run of runs) {
				const result = await organizeImportFurni({
					parentId,
					groups: run,
				});
				if (!result.ok) {
					failedRuns++;
					continue;
				}
				created.push(...(result.data?.created ?? []));
			}
			const moved = created.reduce((sum, c) => sum + c.moved, 0);
			const added = created.reduce((sum, c) => sum + c.added, 0);
			if (created.length > 0) {
				// The server state changed, so client-side undo is no longer valid.
				setHistory([]);
				try {
					window.localStorage.removeItem(HIST_KEY);
				} catch {
					// ignore storage errors
				}
				// Fold the result straight into the mounted catalog tree instead of
				// router.refresh()-ing the route, which would rebuild the whole
				// workspace and throw away scroll position and open panels.
				applyCatalogDelta({
					pages: created
						.filter((c) => c.isNew)
						.map((c) => ({
							id: c.pageId,
							caption: c.caption,
							parentId: c.parentId,
							pageLayout: c.pageLayout,
							iconImage: c.iconImage,
							iconColor: c.iconColor,
							orderNum: c.orderNum,
							enabled: c.enabled,
							visible: c.visible,
						})),
					addedItems: created
						.filter((c) => c.added > 0)
						.map((c) => ({ pageId: c.pageId, count: c.added })),
					movedItems: created.flatMap((c) =>
						c.movedFrom.map((m) => ({
							fromPageId: m.fromPageId,
							toPageId: c.pageId,
							count: m.count,
						})),
					),
				});
			}
			if (failedRuns > 0) {
				toast.error(
					t("errorPartial", { failed: failedRuns, total: runs.length }),
				);
			} else if (moveMode) {
				toast.success(
					t("successMove", {
						moved,
						added,
						destination: destinationCaption ?? "page",
					}),
				);
			} else {
				toast.success(
					runs.length > 1
						? t("successCreateRuns", {
								count: created.length,
								moved,
								added,
								runs: runs.length,
							})
						: t("successCreate", { count: created.length, moved, added }),
				);
			}
			onOpenChange(false);
		} catch (error) {
			logger.error("[OrganizeImports] create failed", {
				err: error as Error,
			});
			toast.error(t("errorFailed"));
		} finally {
			setIsCreating(false);
		}
	};

	const quickPicks = rootPages.slice(0, QUICK_PICKS);
	const dupeList = totalDuplicates > 0;

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="flex h-[90vh] max-h-[90vh] w-[860px] max-w-[95vw] flex-col overflow-hidden p-0">
					<DialogHeader className="flex-none border-b px-4 py-3">
						<DialogTitle className="flex items-center gap-2 text-sm font-semibold">
							<FolderTree className="h-4 w-4" />
							{t("title")}
							{totalSelected > 0 && !loading && (
								<Badge variant="secondary" className="text-[10px]">
									{t("itemsBadge", { count: totalSelected })}
								</Badge>
							)}
							<div className="flex-1 text-[10px] text-muted-foreground ml-2">
								{moveMode ? t("tipMove") : t("tipCreate")}
							</div>
							<p className="text-xs text-muted-foreground ml-2">
								{t("limitHint")}
							</p>
						</DialogTitle>
					</DialogHeader>

					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
						{/* Price (new offers only) */}
						{!loading && groups.length > 0 && (
							<div className="flex flex-wrap items-center gap-2 rounded-md border bg-[var(--admin-surface)] p-3 text-xs">
								<span className="text-xs font-medium text-[var(--admin-text-muted)]">
									{t("price")}
								</span>
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
								{!freeMode && (
									<>
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
												<SelectTrigger className="h-6 w-24 text-[10px]">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="0" className="text-xs">
														{t("pointsTypeDuckets")}
													</SelectItem>
													<SelectItem value="5" className="text-xs">
														{t("pointsTypeDiamonds")}
													</SelectItem>
												</SelectContent>
											</Select>
										</span>
									</>
								)}
								<p className="w-full text-[10px] text-muted-foreground">
									{t("newPriceHint")}
								</p>
							</div>
						)}

						{/* Mode: create new pages vs move into an existing page */}
						{!loading && groups.length > 0 && (
							<div className="flex flex-wrap items-center gap-2 rounded-md border bg-[var(--admin-surface)] p-3 text-xs">
								<span className="text-xs font-medium text-[var(--admin-text-muted)]">
									{t("mode")}
								</span>
								<Button
									type="button"
									variant={!moveMode ? "default" : "outline"}
									size="sm"
									className={cn(
										"h-7 px-3 text-[11px] gap-1.5",
										!moveMode && "ring-2 ring-primary ring-offset-1",
									)}
									onClick={() => {
										setMoveMode(false);
										setDestinationPageId(null);
										setDestinationCaption(null);
									}}
								>
									<Plus className="h-3.5 w-3.5" />
									{t("modeCreate")}
								</Button>
								<Button
									type="button"
									variant={moveMode ? "default" : "outline"}
									size="sm"
									className={cn(
										"h-7 px-3 text-[11px] gap-1.5",
										moveMode && "ring-2 ring-primary ring-offset-1",
									)}
									onClick={() => setMoveMode(true)}
								>
									<ArrowRight className="h-3.5 w-3.5" />
									{t("modeMove")}
								</Button>
							</div>
						)}

						{/* Destination page (move mode) */}
						{moveMode && !loading && groups.length > 0 && (
							<div className="flex flex-col gap-1 rounded-md border bg-[var(--admin-surface)] p-3 text-xs font-medium text-[var(--admin-text-muted)]">
								<span className="text-[10px]">{t("destination")}</span>
								{destinationPageId != null ? (
									<div className="flex flex-col gap-1">
										<div className="flex items-center gap-2 rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-subtle)] px-2 py-1.5">
											<Folder className="h-3.5 w-3.5 shrink-0" />
											<span className="min-w-0 flex-1 truncate text-sm font-semibold">
												{destinationCaption}
											</span>
											{destDupesLoading && (
												<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
											)}
											<Badge variant="secondary" className="h-4 text-[9px]">
												{t("destinationChosen")}
											</Badge>
											<button
												type="button"
												onClick={() => {
													setDestinationPageId(null);
													setDestinationCaption(null);
													setDestQuery("");
												}}
												className="text-muted-foreground hover:text-destructive"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
										{dupeList && (
											<p className="flex items-center gap-1 text-[10px] text-[var(--admin-warning)]">
												<AlertTriangle className="h-3 w-3 shrink-0" />
												{t("dupeSummary", { count: totalDuplicates })}
											</p>
										)}
									</div>
								) : (
									<>
										<div className="relative">
											<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
											<Input
												className="h-8 pl-8 text-xs"
												placeholder={t("destinationSearchPlaceholder")}
												value={destQuery}
												onChange={(e) => setDestQuery(e.target.value)}
											/>
											{destSearchLoading && (
												<Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
											)}
										</div>
										{/* Quick pick: click a root page without typing */}
										{destQuery.length < 2 && quickPicks.length > 0 && (
											<div className="flex max-h-[140px] flex-wrap gap-1 overflow-y-auto rounded border bg-[var(--admin-canvas)] p-1.5">
												{quickPicks.map((p) => (
													<button
														type="button"
														key={p.id}
														onClick={() => {
															setDestinationPageId(p.id);
															setDestinationCaption(p.caption);
														}}
														className="flex max-w-full items-center gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-[10px] text-[var(--admin-text)] hover:border-current"
													>
														<Folder className="h-3 w-3 shrink-0" />
														<span className="min-w-0 truncate">
															{p.caption}
														</span>
													</button>
												))}
											</div>
										)}
										{destQuery.length >= 2 && (
											<div className="max-h-[160px] divide-y overflow-y-auto rounded border">
												{destResults.length === 0 && !destSearchLoading ? (
													<p className="py-3 text-center text-[10px] text-muted-foreground">
														{t("noDestResults")}
													</p>
												) : (
													destResults.map((p) => (
														<button
															type="button"
															key={p.id}
															onClick={() => {
																setDestinationPageId(p.id);
																setDestinationCaption(p.caption);
															}}
															className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
														>
															<Folder className="h-3.5 w-3.5 shrink-0" />
															<span className="min-w-0 flex-1 truncate text-xs">
																{p.caption}
															</span>
															<span className="font-mono text-[9px] text-muted-foreground">
																#{p.id}
															</span>
														</button>
													))
												)}
											</div>
										)}
									</>
								)}
								<p className="text-[10px] text-muted-foreground">
									{t("destinationHint")}
								</p>
							</div>
						)}

						{/* Parent */}
						{!moveMode && !loading && groups.length > 0 && (
							<div className="flex flex-col gap-1 rounded-md border bg-[var(--admin-surface)] p-3 text-xs font-medium text-[var(--admin-text-muted)]">
								{t("parent")}
								<Select
									value={String(parentId)}
									onValueChange={(v) => setParentId(Number(v))}
								>
									<SelectTrigger className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="-1" className="text-xs">
											<span className="flex items-center gap-1.5">
												<Home className="h-3 w-3 shrink-0" />
												{t("root")}
											</span>
										</SelectItem>
										{importRootPageId != null && (
											<SelectItem
												value={String(importRootPageId)}
												className="text-xs"
											>
												<span className="flex items-center gap-1.5">
													<Folder className="h-3 w-3 shrink-0" />
													{importRootCaption ?? t("importedRoot")}
												</span>
											</SelectItem>
										)}
										{parentOptions.map((p) => (
											<SelectItem
												key={p.id}
												value={String(p.id)}
												className="text-xs"
											>
												<span className="flex items-center gap-1.5">
													<Folder className="h-3 w-3 shrink-0" />
													{p.caption}
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* Loading / empty / groups */}
						{loading ? (
							<div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								{t("loading")}
							</div>
						) : groups.length === 0 ? (
							<div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
								{loadError ? t("loadError") : t("empty")}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => void load(days)}
								>
									<RefreshCw className="mr-1 h-3 w-3" />
									{t("refresh")}
								</Button>
							</div>
						) : (
							<>
								<div className="flex flex-col gap-2 rounded-md border bg-[var(--admin-surface)] p-3 text-xs">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="relative min-w-[160px] flex-1">
											<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
											<Input
												className="h-8 pl-8 text-xs"
												placeholder={t("searchGroups")}
												value={groupSearchQuery}
												onChange={(e) => setGroupSearchQuery(e.target.value)}
											/>
										</div>
										<label className="flex cursor-pointer items-center gap-1.5 select-none rounded border bg-background/50 px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
											<input
												type="checkbox"
												checked={onlyUnplaced}
												onChange={(e) => setOnlyUnplaced(e.target.checked)}
												className="h-3 w-3 rounded border-[var(--admin-border)]"
											/>
											<span>{t("onlyUnplaced")}</span>
										</label>
										<Select
											value={String(days)}
											onValueChange={(v) => changeDays(Number(v))}
										>
											<SelectTrigger className="h-8 w-[110px] text-[10px]">
												<SelectValue placeholder={t("daysLabel")} />
											</SelectTrigger>
											<SelectContent>
												{DAYS_OPTIONS.map((d) => (
													<SelectItem
														key={d}
														value={String(d)}
														className="text-xs"
													>
														{t("daysValue", { days: d })}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-8 px-2.5 text-[10px]"
											onClick={toggleAll}
										>
											{allApproved ? t("deselectAll") : t("selectAll")}
										</Button>
									</div>

									{/* Batch Actions Bar */}
									<div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
										<span className="text-[10px] font-medium text-muted-foreground">
											{t("batchLabel")}
										</span>
										<Select
											value={batchLayout}
											onValueChange={(v) => {
												if (isValidCatalogLayout(v)) {
													setBatchLayout(v);
													applyBatchLayout(v);
												}
											}}
										>
											<SelectTrigger className="h-7 w-[140px] text-[10px]">
												<SelectValue placeholder={t("batchLayout")} />
											</SelectTrigger>
											<SelectContent>
												{CATALOG_LAYOUTS.map((l) => (
													<SelectItem key={l} value={l} className="text-xs">
														{l === "default_3x3"
															? t("layoutFallbackDefault3x3")
															: l}
													</SelectItem>
												))}
											</SelectContent>
										</Select>

										<div className="flex items-center gap-1">
											<Input
												className="h-7 w-[120px] text-[10px]"
												placeholder={t("batchPrefix")}
												value={batchPrefix}
												onChange={(e) => setBatchPrefix(e.target.value)}
											/>
											<Button
												type="button"
												variant="secondary"
												size="sm"
												className="h-7 px-2 text-[10px]"
												onClick={applyBatchPrefix}
											>
												{t("applyBatch")}
											</Button>
										</div>

										{history.length > 0 && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="h-7 px-2 text-[10px]"
												onClick={undo}
											>
												<Undo2 className="mr-1 h-3 w-3" />
												{t("undo")}
											</Button>
										)}
										{Object.keys(overrides).length > 0 && (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
												onClick={resetAllOverrides}
											>
												<RefreshCw className="mr-1 h-3 w-3" />
												{t("resetAll")}
											</Button>
										)}
									</div>

									{/* Move selected to another category */}
									{selection.size > 0 && (
										<div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-subtle)] px-2.5 py-2">
											<span className="text-[10px] font-semibold text-[var(--admin-accent)]">
												{t("selectedCount", { count: selection.size })}
											</span>
											<span className="text-[10px] text-muted-foreground">
												{t("batchMoveTo")}
											</span>
											<Select
												value=""
												onValueChange={(v) => {
													if (v) moveSelectedToGroup(v);
												}}
											>
												<SelectTrigger className="h-7 w-[180px] text-[10px]">
													<SelectValue placeholder={t("batchMoveTo")} />
												</SelectTrigger>
												<SelectContent>
													{groups.map((g) => (
														<SelectItem
															key={g.name}
															value={g.name}
															className="text-xs"
														>
															{g.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
												onClick={() => setSelection(new Set())}
											>
												<Trash2 className="mr-1 h-3 w-3" />
												{t("clearSelection")}
											</Button>
										</div>
									)}
								</div>

								{filteredGroups.map((group) => {
									const o = overrides[group.name] ?? {};
									const caption = o.caption ?? group.name;
									const icon = o.icon ?? group.icon;
									const layout = o.layout ?? group.layout ?? "default_3x3";
									const isApproved = approved[group.name] !== false;
									const movedCount = group.items.filter(
										(i) => i.alreadyPlaced,
									).length;
									const addedCount = group.items.length - movedCount;
									const isHoverTarget =
										hoverGroup === group.name &&
										drag != null &&
										drag.from !== group.name;
									const moveTargets = moveItemOptions(group.name);
									return (
										// biome-ignore lint/a11y/noStaticElementInteractions: drop target container with native HTML5 DnD
										<div
											key={group.name}
											onDragOver={(e) => {
												if (drag && drag.from !== group.name) {
													e.preventDefault();
													e.dataTransfer.dropEffect = "move";
													setHoverGroup(group.name);
												}
											}}
											onDrop={(e) => {
												e.preventDefault();
												setHoverGroup(null);
												if (drag && drag.from !== group.name) {
													moveItemToGroup(drag.item, drag.from, group.name);
												}
												setDrag(null);
											}}
											className={cn(
												"block rounded-md border bg-[var(--admin-surface)] p-3 transition-colors",
												isApproved
													? "border-[var(--admin-accent)]/40"
													: "opacity-70",
												isHoverTarget &&
													"ring-2 ring-[var(--admin-accent)] ring-offset-1",
											)}
										>
											<div className="flex items-center gap-2">
												<input
													type="checkbox"
													checked={isApproved}
													onChange={(e) =>
														setApproved((prev) => ({
															...prev,
															[group.name]: e.target.checked,
														}))
													}
												/>
												<CatalogIcon iconImage={group.icon} size={20} />
												<p className="min-w-0 flex-1 truncate text-sm font-semibold">
													{group.name}
												</p>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-5 gap-1 px-1.5 text-[10px]"
													onClick={() => setPreviewGroup(group)}
												>
													<Eye className="h-3 w-3" />
													{t("visualPreview")}
												</Button>
												<Badge variant="secondary" className="h-4 text-[9px]">
													{group.items.length}
												</Badge>
												{movedCount > 0 && (
													<Badge
														variant="outline"
														className="h-4 gap-1 text-[9px] text-muted-foreground"
													>
														{t("movedLabel", { count: movedCount })}
													</Badge>
												)}
												{addedCount > 0 && (
													<Badge
														variant="outline"
														className="h-4 gap-1 text-[9px] text-muted-foreground"
													>
														{t("newLabel", { count: addedCount })}
													</Badge>
												)}
											</div>

											{!moveMode && (
												<div className="mt-3 space-y-2 border-t pt-2 text-xs font-medium text-[var(--admin-text-muted)]">
													<div className="flex items-center gap-1">
														<span className="w-12 shrink-0 text-[10px]">
															{t("name")}
														</span>
														<Input
															className="h-7 text-xs"
															value={caption}
															onChange={(e) =>
																updateGroup(group.name, {
																	caption: e.target.value,
																})
															}
														/>
														{caption !== group.name && (
															<Button
																type="button"
																variant="outline"
																size="sm"
																className="h-7 shrink-0 px-2 text-[10px]"
																onClick={() =>
																	updateGroup(group.name, {
																		caption: group.name,
																	})
																}
															>
																<Wand2 className="mr-0.5 h-2.5 w-2.5" />
																{t("resetSuggestion")}
															</Button>
														)}
													</div>

													<div className="flex items-center gap-1">
														<span className="w-12 shrink-0 text-[10px]">
															{t("icon")}
														</span>
														<IconPicker
															value={icon}
															onChange={(id) =>
																updateGroup(group.name, { icon: id })
															}
														>
															<Button
																type="button"
																variant="outline"
																size="sm"
																className="h-7 gap-1.5 px-2"
															>
																<CatalogIcon iconImage={icon} size={16} />
																<span className="font-mono text-[10px] text-muted-foreground">
																	#{icon}
																</span>
															</Button>
														</IconPicker>
														{icon !== group.icon && (
															<Button
																type="button"
																variant="outline"
																size="sm"
																className="h-7 px-2 text-[10px]"
																onClick={() =>
																	updateGroup(group.name, { icon: group.icon })
																}
															>
																<Wand2 className="mr-0.5 h-2.5 w-2.5" />
																{group.icon}
															</Button>
														)}
													</div>

													<div className="flex items-center gap-1">
														<span className="w-12 shrink-0 text-[10px]">
															{t("layout")}
														</span>
														<div className="flex flex-wrap gap-1">
															{CATALOG_LAYOUTS.map((l) => {
																const color =
																	LAYOUT_COLORS[l] ||
																	"bg-muted text-muted-foreground";
																return (
																	<button
																		type="button"
																		key={l}
																		onClick={() =>
																			updateGroup(group.name, { layout: l })
																		}
																		className={cn(
																			"rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
																			layout === l
																				? cn(
																						color,
																						"border-current ring-1 ring-current/20",
																					)
																				: "border-[var(--admin-border)] bg-[var(--admin-canvas)] text-[var(--admin-text-muted)] hover:border-current",
																		)}
																	>
																		{l.replace("default_3x3", "3x3")}
																	</button>
																);
															})}
														</div>
														{group.layout &&
															layout !== group.layout &&
															group.layout !== "default_3x3" && (
																<Button
																	type="button"
																	variant="ghost"
																	size="sm"
																	className="h-6 w-fit border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-2 text-[10px] text-[var(--admin-warning)]"
																	onClick={() =>
																		updateGroup(group.name, {
																			layout:
																				group.layout === null
																					? undefined
																					: isValidCatalogLayout(group.layout)
																						? group.layout
																						: undefined,
																		})
																	}
																>
																	<Wand2 className="mr-0.5 h-2.5 w-2.5" />
																	{t("suggestedLayout", {
																		layout: group.layout,
																	})}
																</Button>
															)}
													</div>

													{/* Compact page-layout preview */}
													<div className="flex items-start gap-2 pt-1">
														<span className="w-12 shrink-0 pt-0.5 text-[10px]">
															{t("layoutPreview")}
														</span>
														<LayoutPreview
															layout={layout}
															items={group.items}
															compact
														/>
													</div>
												</div>
											)}

											{/* Virtualized item list for this category */}
											<div className="mt-2 border-t pt-2">
												<GroupItemList
													items={group.items}
													moveTargets={moveTargets}
													selection={selection}
													destDupes={destDupes}
													onToggleSelect={(itemId, checked) =>
														setSelection((prev) => {
															const next = new Set(prev);
															if (checked) next.add(itemId);
															else next.delete(itemId);
															return next;
														})
													}
													onMoveItem={(item, toName) =>
														moveItemToGroup(item, group.name, toName)
													}
													onDragStart={(item) =>
														setDrag({ item, from: group.name })
													}
													onDragEnd={(item) => {
														if (drag?.item.itemId === item.itemId) {
															setHoverGroup(null);
															setDrag(null);
														}
													}}
												/>
											</div>
										</div>
									);
								})}
							</>
						)}
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
							disabled={
								loading ||
								isCreating ||
								totalSelected === 0 ||
								(moveMode && destinationPageId == null)
							}
							onClick={() => void handleCreate()}
						>
							{isCreating ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Plus className="h-3 w-3" />
							)}
							{moveMode
								? t("move", { count: totalSelected })
								: t("create", { count: selectedGroupsCount })}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Visual Preview Sub-Dialog */}
			<Dialog
				open={previewGroup != null}
				onOpenChange={(open) => !open && setPreviewGroup(null)}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-base">
							<CatalogIcon iconImage={previewGroup?.icon ?? 1} size={24} />
							<span>{previewGroup?.name}</span>
						</DialogTitle>
					</DialogHeader>
					{previewGroup && (
						<div className="flex flex-col gap-3 py-2 text-xs">
							<div className="flex items-center justify-between rounded border bg-muted/30 p-2.5">
								<div>
									<span className="font-semibold">{t("layout")}:</span>{" "}
									<span className="font-mono text-[11px]">
										{previewGroup.layout ?? "default_3x3"}
									</span>
								</div>
								<Badge variant="outline" className="text-[10px]">
									{previewGroup.items.length} {t("itemsUnit")}
								</Badge>
							</div>
							{previewGroup.layout &&
								LAYOUT_DESCRIPTIONS[previewGroup.layout] && (
									<p className="text-[11px] text-muted-foreground italic">
										{LAYOUT_DESCRIPTIONS[previewGroup.layout]}
									</p>
								)}
							<div className="rounded border bg-[var(--admin-canvas)] p-3">
								<p className="mb-2 flex items-center gap-1 text-[10px] font-medium text-[var(--admin-text-muted)]">
									<LayoutGrid className="h-3 w-3" />
									{t("layoutPreview")}
								</p>
								<LayoutPreview
									layout={previewGroup.layout ?? "default_3x3"}
									items={previewGroup.items}
								/>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
