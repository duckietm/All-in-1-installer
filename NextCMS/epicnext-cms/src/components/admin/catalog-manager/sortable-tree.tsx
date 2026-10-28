"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ChevronsDownUp,
	ChevronsUpDown,
	FolderOpen,
	GripVertical,
	Loader2,
	MousePointer,
	Plus,
	Power,
	PowerOff,
	Search,
	ToggleLeft,
	ToggleRight,
	Trash2,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createCatalogPage,
	deleteTreePage,
	reorderCatalogPages,
	reorderTreePage,
	toggleCatalogPage,
} from "@/actions/catalog";
import {
	createBcPage,
	deleteBcTreePage,
	reorderBcCatalogPages,
	reorderBcTreePage,
	toggleBcPage,
} from "@/actions/catalog-bc";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { requestCatalogNavigation } from "@/features/catalog/client/use-catalog-navigation";
import { useLiveCatalog } from "@/features/catalog/client/use-live-catalog";
import { DuplicateCategoryDialog } from "@/features/catalog/components/duplicate-category-dialog";
import type { DuplicateInput } from "@/features/catalog/domain/duplicate";
import { logger } from "@/lib/browser-log";
import { cn } from "@/lib/utils";
import {
	type FlatTreeNode,
	SortableTreeItem,
	TreeItemContent,
	type TreeItemProps,
} from "./tree-item";
import {
	restoreDeletedPage,
	showUndoableDeleteToast,
} from "./undo-page-delete";
import { catalogTreeQs, useCatalogManager } from "./use-catalog-store";

/* ─── Types ──────────────────────────────────────────────── */

export type { TreeNodeData, TreeNodeUpdate } from "@/types/catalog";

import type { TreeNodeData, TreeNodeUpdate } from "@/types/catalog";

interface SortableTreeProps {
	activeTabId: number | null;
	selectedPageId: number | null;
	onSelectPage: (id: number) => void | Promise<void>;
	onTreeMutation: () => void;
	nodeUpdate?: TreeNodeUpdate | null;
}

type FilterMode = "all" | "enabled" | "disabled";

/* ─── Component ──────────────────────────────────────────── */

export function SortableTree({
	activeTabId,
	selectedPageId,
	onSelectPage,
	onTreeMutation,
	nodeUpdate,
}: SortableTreeProps) {
	const { state, dispatch, catalogType, canEdit } = useCatalogManager();
	const t = useTranslations("pages.admin.catalog.workspace.duplicate");
	const catQs = catalogTreeQs(catalogType);
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const {
		nodes,
		childrenMap,
		expandedIds,
		loadingIds,
		multiSelectedIds,
		focusedId,
		sortMode,
	} = state;

	const [duplicateSource, setDuplicateSource] = useState<DuplicateInput | null>(
		null,
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<TreeNodeData[] | null>(
		null,
	);
	const [subpageParentId, setSubpageParentId] = useState<number | null>(null);
	const [subpageName, setSubpageName] = useState("");
	const [creatingSubpage, setCreatingSubpage] = useState(false);
	const [searching, setSearching] = useState(false);
	const [activeId, setActiveId] = useState<number | null>(null);
	const [treeLoading, setTreeLoading] = useState(false);
	const [filter, setFilter] = useState<FilterMode>("all");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const treeRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const normalizePages = useCallback(
		(pages: TreeNodeData[]): TreeNodeData[] => {
			return pages.map((p) => ({
				...p,
				id: Number(p.id),
				parentId: Number(p.parentId),
				enabled: String(p.enabled ?? "0"),
				visible: String(p.visible ?? "0"),
				iconImage: Number(p.iconImage) || 0,
				iconColor: Number(p.iconColor) || 0,
				childCount: Number(p.childCount) || 0,
				itemCount: Number(p.itemCount) || 0,
				orderNum: Number(p.orderNum) || 0,
			}));
		},
		[],
	);

	/**
	 * Load children of a page — same endpoint CatalogTree uses successfully.
	 * Avoids mode=full which times out / fails on large catalogs (2k+ pages).
	 */
	const loadChildren = useCallback(
		async (parentId: number): Promise<TreeNodeData[]> => {
			const res = await fetch(
				`/cms_api/admin/catalog/tree?parentId=${parentId}${catQs}`,
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || "Failed to load pages");
			return normalizePages(data.pages || []);
		},
		[normalizePages, catQs],
	);

	const loadTabTree = useCallback(async () => {
		if (activeTabId === null) return;
		setTreeLoading(true);
		try {
			const pages = await loadChildren(activeTabId);
			dispatch({
				type: "SET_CHILDREN",
				parentId: activeTabId,
				children: pages,
			});
		} catch {
			toast.error("Failed to load catalog pages");
		} finally {
			setTreeLoading(false);
		}
	}, [activeTabId, dispatch, loadChildren]);

	/** Reload a specific parent's children after mutation (targeted refresh). */
	const refreshParent = useCallback(
		async (parentId: number) => {
			try {
				const pages = await loadChildren(parentId);
				dispatch({ type: "SET_CHILDREN", parentId, children: pages });
			} catch {
				// Fallback to full reload only on error
				await loadTabTree();
			}
		},
		[loadChildren, dispatch, loadTabTree],
	);

	// Expose reload for mutations spanning multiple parents (bulk/duplicate)
	const loadFullTree = loadTabTree;

	// Load tab children when active root changes (same as Catalog Structure expand)
	useEffect(() => {
		if (activeTabId === null) return;
		setSearchQuery("");
		setSearchResults(null);
		setFilter("all");
		dispatch({ type: "COLLAPSE_ALL" });
		void loadTabTree();
	}, [activeTabId, loadTabTree, dispatch]);

	/**
	 * This tree is loaded per root tab, so it cannot see writes that happen
	 * elsewhere in the session — an import settling, or a page edited through the
	 * Studio. The live store is where those land; when it changes, re-read this
	 * tab so the dialog never shows pre-import nodes.
	 */
	const liveTree = useLiveCatalog().tree;
	const seenLiveTree = useRef(liveTree);
	useEffect(() => {
		if (liveTree === seenLiveTree.current) return;
		seenLiveTree.current = liveTree;
		if (activeTabId === null) return;
		void loadTabTree();
	}, [liveTree, activeTabId, loadTabTree]);

	// Ignore stale search completions when the query or catalog changes.
	useEffect(() => {
		const controller = new AbortController();
		setSearchResults(null);
		setSearching(false);
		if (!searchQuery.trim()) return;
		const timeout = setTimeout(async () => {
			setSearching(true);
			try {
				const res = await fetch(
					`/cms_api/admin/catalog/tree?search=${encodeURIComponent(searchQuery.trim())}${catQs}`,
					{ signal: controller.signal },
				);
				if (!res.ok) throw new Error("Search failed");
				const data = await res.json();
				if (!controller.signal.aborted) setSearchResults(data.pages || []);
			} catch {
				if (!controller.signal.aborted)
					toast.error("Failed to search catalog pages");
			} finally {
				if (!controller.signal.aborted) setSearching(false);
			}
		}, 300);
		return () => {
			controller.abort();
			clearTimeout(timeout);
		};
	}, [searchQuery, catQs]);

	// Apply external node updates
	useEffect(() => {
		if (!nodeUpdate) return;
		dispatch({ type: "UPDATE_NODE", update: nodeUpdate });
	}, [nodeUpdate, dispatch]);

	// Toggle expand — lazy-fetch children when needed (CatalogTree pattern)
	const handleToggleExpand = useCallback(
		async (id: number) => {
			if (expandedIds.has(id)) {
				dispatch({ type: "SET_EXPANDED", id, expanded: false });
				return;
			}
			const node = nodes.get(id);
			const existing = childrenMap.get(id);
			if (node && node.childCount > 0 && (!existing || existing.length === 0)) {
				dispatch({
					type: "SET_LOADING_IDS",
					ids: new Set([...loadingIds, id]),
				});
				try {
					const pages = await loadChildren(id);
					dispatch({ type: "SET_CHILDREN", parentId: id, children: pages });
				} catch {
					toast.error("Failed to load subpages");
				} finally {
					const next = new Set(loadingIds);
					next.delete(id);
					dispatch({ type: "SET_LOADING_IDS", ids: next });
				}
			}
			dispatch({ type: "SET_EXPANDED", id, expanded: true });
		},
		[expandedIds, dispatch, nodes, childrenMap, loadingIds, loadChildren],
	);

	// ── Flatten visible tree with filter ────────────────────────
	const flatItems = useMemo((): FlatTreeNode[] => {
		if (activeTabId === null) return [];
		if (searchResults) {
			return searchResults.map((n) => ({ ...n, depth: 0, isExpanded: false }));
		}
		const result: FlatTreeNode[] = [];
		const traverse = (parentId: number, depth: number) => {
			const childIds = childrenMap.get(parentId) || [];
			for (const cid of childIds) {
				const node = nodes.get(cid);
				if (!node) continue;
				if (filter === "enabled" && node.enabled !== "1") continue;
				if (filter === "disabled" && node.enabled === "1") continue;
				const isExpanded = expandedIds.has(cid);
				result.push({ ...node, depth, isExpanded });
				if (isExpanded) traverse(cid, depth + 1);
			}
		};
		traverse(activeTabId, 0);

		// If this root has no children yet, still show the root page itself
		// so categories are editable (matches page CatalogTree expectations).
		if (result.length === 0) {
			const rootNode = nodes.get(activeTabId);
			if (rootNode) {
				if (
					!(filter === "enabled" && rootNode.enabled !== "1") &&
					!(filter === "disabled" && rootNode.enabled === "1")
				) {
					result.push({ ...rootNode, depth: 0, isExpanded: false });
				}
			}
		}
		return result;
	}, [activeTabId, nodes, childrenMap, expandedIds, searchResults, filter]);

	const flatIds = useMemo(() => flatItems.map((n) => n.id), [flatItems]);
	const totalNodes = nodes.size;

	// ── Ancestor highlight ──────────────────────────────────────
	const ancestorIds = useMemo(() => {
		const set = new Set<number>();
		if (!selectedPageId) return set;
		let current = nodes.get(selectedPageId);
		while (current && current.parentId > 0) {
			set.add(current.parentId);
			current = nodes.get(current.parentId);
		}
		return set;
	}, [selectedPageId, nodes]);

	// ── Virtualizer ─────────────────────────────────────────────
	const virtualizer = useVirtualizer({
		count: flatItems.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 30,
		overscan: 20,
	});

	// Auto-scroll to selected page
	useEffect(() => {
		if (!selectedPageId) return;
		const idx = flatIds.indexOf(selectedPageId);
		if (idx >= 0) {
			// Delay slightly to let virtualizer settle
			requestAnimationFrame(() =>
				virtualizer.scrollToIndex(idx, { align: "center" }),
			);
		}
	}, [selectedPageId, flatIds, virtualizer]);

	// ── Keyboard navigation ─────────────────────────────────────
	const handleDeleteRef = useRef<(id: number) => Promise<void>>(async () => {});
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
				if (e.key === "/") {
					e.preventDefault();
					searchInputRef.current?.focus();
				}
				return;
			}
			if (e.key === "/") {
				e.preventDefault();
				searchInputRef.current?.focus();
				return;
			}
			if (e.key === "Escape") {
				if (searchQuery) {
					setSearchQuery("");
					setSearchResults(null);
				} else dispatch({ type: "CLEAR_MULTI_SELECT" });
				return;
			}

			const currentIdx = focusedId ? flatIds.indexOf(focusedId) : -1;

			if (e.key === "ArrowDown") {
				e.preventDefault();
				const nextIdx = currentIdx < flatIds.length - 1 ? currentIdx + 1 : 0;
				dispatch({ type: "SET_FOCUSED", id: flatIds[nextIdx] });
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const prevIdx = currentIdx > 0 ? currentIdx - 1 : flatIds.length - 1;
				dispatch({ type: "SET_FOCUSED", id: flatIds[prevIdx] });
			} else if (e.key === "ArrowRight" && focusedId) {
				e.preventDefault();
				const node = flatItems.find((n) => n.id === focusedId);
				if (node && node.childCount > 0 && !node.isExpanded) {
					handleToggleExpand(focusedId);
				} else if (node?.isExpanded) {
					const children = childrenMap.get(focusedId);
					if (children?.[0]) dispatch({ type: "SET_FOCUSED", id: children[0] });
				}
			} else if (e.key === "ArrowLeft" && focusedId) {
				e.preventDefault();
				const node = flatItems.find((n) => n.id === focusedId);
				if (node?.isExpanded) {
					dispatch({ type: "SET_EXPANDED", id: focusedId, expanded: false });
				} else {
					const parent = nodes.get(focusedId);
					if (parent?.parentId && parent.parentId > 0)
						dispatch({ type: "SET_FOCUSED", id: parent.parentId });
				}
			} else if (e.key === "Enter" && focusedId) {
				e.preventDefault();
				onSelectPage(focusedId);
			} else if (e.key === " " && focusedId) {
				e.preventDefault();
				dispatch({ type: "TOGGLE_MULTI_SELECT", id: focusedId });
			} else if (e.key === "Delete" && focusedId) {
				e.preventDefault();
				handleDeleteRef.current(focusedId);
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [
		focusedId,
		flatIds,
		flatItems,
		searchQuery,
		childrenMap,
		nodes,
		dispatch,
		onSelectPage,
		handleToggleExpand,
	]);

	// ── Selection with Ctrl/Shift ───────────────────────────────
	const handleSelect = useCallback(
		(id: number, e?: React.MouseEvent) => {
			if (e?.ctrlKey || e?.metaKey) {
				dispatch({ type: "TOGGLE_MULTI_SELECT", id });
			} else if (e?.shiftKey && focusedId) {
				dispatch({ type: "RANGE_SELECT", from: focusedId, to: id, flatIds });
			} else {
				onSelectPage(id);
			}
		},
		[focusedId, flatIds, dispatch, onSelectPage],
	);

	// ── DnD handlers ────────────────────────────────────────────
	const handleDragStart = (event: DragStartEvent) =>
		setActiveId(event.active.id as number);

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveId(null);
		if (!canEdit || !over || active.id === over.id || activeTabId === null)
			return;

		const activeNode = nodes.get(active.id as number);
		const overNode = nodes.get(over.id as number);
		if (!activeNode || !overNode) return;

		if (activeNode.parentId === overNode.parentId) {
			// ── Same-parent reorder ──────────────────────────────
			const parentId = activeNode.parentId;
			const siblings = childrenMap.get(parentId) || [];
			const oldIndex = siblings.indexOf(active.id as number);
			const newIndex = siblings.indexOf(over.id as number);
			if (oldIndex === -1 || newIndex === -1) return;
			const newOrder = arrayMove(siblings, oldIndex, newIndex);
			dispatch({
				type: "SET_CHILDREN",
				parentId,
				children: newOrder
					.map((id) => nodes.get(id))
					.filter((n): n is NonNullable<typeof n> => Boolean(n)),
			});

			const reorder =
				catalogType === "bc" ? reorderBcCatalogPages : reorderCatalogPages;
			try {
				const result = await reorder({
					parentId,
					ids: newOrder,
					expectedIds: siblings,
				});
				if (!result.ok) throw Error("Failed to reorder");
				toast.success("Reordered");
				onTreeMutation();
			} catch {
				toast.error("Failed to reorder");
				await refreshParent(parentId);
			}
		} else {
			// ── Cross-parent move (optimistic) ───────────────────
			const movedId = active.id as number;
			const newParentId = overNode.parentId;
			const oldParentId = activeNode.parentId;
			const overIndex = (childrenMap.get(newParentId) || []).indexOf(
				over.id as number,
			);
			const newOrderNum =
				overIndex >= 0
					? overIndex + 1
					: (childrenMap.get(newParentId) || []).length + 1;

			// Snapshot for rollback
			const prevOldSiblings = [...(childrenMap.get(oldParentId) || [])];
			const prevNewSiblings = [...(childrenMap.get(newParentId) || [])];

			// Optimistically move: remove from old parent, insert into new parent
			const newSiblings = [...prevNewSiblings];
			const insertIdx = newSiblings.indexOf(over.id as number);
			if (insertIdx >= 0) newSiblings.splice(insertIdx, 0, movedId);
			else newSiblings.push(movedId);

			dispatch({
				type: "SET_CHILDREN",
				parentId: oldParentId,
				children: prevOldSiblings
					.filter((id) => id !== movedId)
					.map((id) => nodes.get(id))
					.filter((n): n is NonNullable<typeof n> => Boolean(n)),
			});
			dispatch({
				type: "SET_CHILDREN",
				parentId: newParentId,
				children: newSiblings
					.map((id) => nodes.get(id))
					.filter((n): n is NonNullable<typeof n> => Boolean(n)),
			});
			dispatch({
				type: "UPDATE_NODE",
				update: { id: movedId, parentId: newParentId },
			});

			const reorder =
				catalogType === "bc" ? reorderBcTreePage : reorderTreePage;
			try {
				const result = await reorder({
					pageId: movedId,
					newParentId,
					newOrderNum,
				});
				if (!result.ok) throw new Error();
				// Refresh both parents to get correct server-side order
				await Promise.all([
					refreshParent(oldParentId),
					refreshParent(newParentId),
				]);
				onTreeMutation();
				toast.success("Page moved");
			} catch {
				toast.error("Failed to move page");
				// Rollback: restore both parent children lists
				dispatch({
					type: "SET_CHILDREN",
					parentId: oldParentId,
					children: prevOldSiblings
						.map((id) => nodes.get(id))
						.filter((n): n is NonNullable<typeof n> => Boolean(n)),
				});
				dispatch({
					type: "SET_CHILDREN",
					parentId: newParentId,
					children: prevNewSiblings
						.map((id) => nodes.get(id))
						.filter((n): n is NonNullable<typeof n> => Boolean(n)),
				});
				dispatch({
					type: "UPDATE_NODE",
					update: { id: movedId, parentId: oldParentId },
				});
			}
		}
	};

	// ── Actions ─────────────────────────────────────────────────
	const handleAddSubpage = (parentId: number) => {
		if (!canEdit) return;
		setSubpageParentId(parentId);
		setSubpageName("");
	};

	const handleCreateSubpage = async () => {
		if (!canEdit || subpageParentId === null || !subpageName.trim()) return;
		setCreatingSubpage(true);
		const parentId = subpageParentId;
		const name = subpageName.trim();
		try {
			const result =
				catalogType === "bc"
					? await createBcPage({
							parentId,
							caption: name,
						})
					: await createCatalogPage({
							parentId,
							caption: name,
						});
			if (!result.ok) throw new Error(result.error);
			const data = result.data as Record<string, unknown>;
			const newId = data.id as number;

			// Optimistically add the new node to the tree
			const newNode: TreeNodeData = {
				id: newId,
				parentId,
				caption: name,
				enabled: "1",
				visible: "1",
				iconImage: 0,
				iconColor: 0,
				pageLayout: "default_3x3",
				childCount: 0,
				itemCount: 0,
				orderNum: 0,
			};
			dispatch({ type: "SET_NODES", nodes: [newNode] });
			dispatch({ type: "SET_EXPANDED", id: parentId, expanded: true });

			// Refresh parent children to get correct server-side order
			await refreshParent(parentId);
			onSelectPage(newId);
			onTreeMutation();
			setSubpageParentId(null);
			setSubpageName("");
			toast.success("Subpage created");
		} catch {
			toast.error("Failed to create subpage");
		} finally {
			setCreatingSubpage(false);
		}
	};

	const handleToggleEnabled = async (id: number, currentEnabled: string) => {
		if (!canEdit) return;
		const newEnabled = currentEnabled === "1" ? "0" : "1";
		try {
			const result =
				catalogType === "bc"
					? await toggleBcPage({ id, field: "enabled" })
					: await toggleCatalogPage({ id, action: "toggleEnabled" });
			if (!result.ok) throw new Error();
			dispatch({ type: "UPDATE_NODE", update: { id, enabled: newEnabled } });
			onTreeMutation();
		} catch {
			toast.error("Failed to toggle enabled");
		}
	};

	const handleToggleVisible = async (id: number, currentVisible: string) => {
		if (!canEdit) return;
		const newVisible = currentVisible === "1" ? "0" : "1";
		try {
			const result =
				catalogType === "bc"
					? await toggleBcPage({ id, field: "visible" })
					: await toggleCatalogPage({ id, action: "toggleVisible" });
			if (!result.ok) throw new Error();
			dispatch({ type: "UPDATE_NODE", update: { id, visible: newVisible } });
			onTreeMutation();
		} catch {
			toast.error("Failed to toggle visibility");
		}
	};

	const handleDelete = async (id: number) => {
		if (!canEdit) return;
		const node = nodes.get(id);
		const parentId = node?.parentId ?? -1;
		const snapshot = node
			? {
					caption: node.caption,
					parentId: node.parentId,
					pageLayout: node.pageLayout,
					iconImage: node.iconImage,
					iconColor: node.iconColor,
					enabled: node.enabled,
					visible: node.visible,
					orderNum: node.orderNum,
				}
			: null;
		const childInfo =
			node && node.childCount > 0
				? ` Its ${node.childCount} child page(s) will be moved to the parent.`
				: "";
		const itemInfo =
			node && node.itemCount > 0
				? ` ${node.itemCount} item(s) on this page will be deleted.`
				: "";
		const ok = await confirm({
			title: "Delete page",
			description: `Delete "${node?.caption ?? id}"?${childInfo}${itemInfo}`,
			confirmLabel: "Delete",
		});
		if (!ok) return;
		try {
			const result =
				catalogType === "bc"
					? await deleteBcTreePage({ pageId: id, mode: "reparent" })
					: await deleteTreePage({ pageId: id, mode: "reparent" });
			if (!result.ok) throw new Error();
			dispatch({ type: "REMOVE_NODE", id });
			if (selectedPageId === id) onSelectPage(-1);
			// Children were reparented up — refresh only the affected parent.
			await refreshParent(parentId);
			onTreeMutation();
			if (snapshot) {
				showUndoableDeleteToast(
					`Page "${node?.caption ?? ""}" deleted`,
					async () => {
						const newId = await restoreDeletedPage(catalogType, snapshot);
						if (!newId) {
							toast.error("Could not restore page");
							return;
						}
						dispatch({ type: "EXPAND_PATH", ids: [snapshot.parentId] });
						await refreshParent(snapshot.parentId);
						onTreeMutation();
						onSelectPage(newId);
					},
				);
			}
		} catch {
			toast.error("Failed to delete page");
		}
	};
	handleDeleteRef.current = handleDelete;

	const handleDuplicate = useCallback(
		(id: number) => {
			if (state.editorDirty) {
				toast.error(t("draftBlocked"));
				return;
			}
			if (!canEdit || !requestCatalogNavigation()) return;
			const node = nodes.get(id);
			if (!node) return;
			setDuplicateSource({
				kind: catalogType,
				sourceId: id,
				parentId: node.parentId,
				name: `${node.caption.slice(0, 121)} (copy)`,
			});
		},
		[state.editorDirty, t, canEdit, nodes, catalogType],
	);

	// ── Expand/Collapse all ─────────────────────────────────────
	const handleExpandAll = useCallback(() => {
		if (activeTabId === null) return;
		const firstLevel = childrenMap.get(activeTabId) || [];
		dispatch({ type: "EXPAND_PATH", ids: firstLevel });
		// Lazy-load each first-level node's children in background
		for (const id of firstLevel) {
			const node = nodes.get(id);
			if (node && node.childCount > 0 && !childrenMap.get(id)?.length) {
				void loadChildren(id)
					.then((pages) => {
						dispatch({ type: "SET_CHILDREN", parentId: id, children: pages });
						dispatch({
							type: "EXPAND_PATH",
							ids: pages.map((p) => p.id),
						});
					})
					.catch((error) =>
						logger.error("[SortableTree] Failed to load children", {
							err: error as Error,
						}),
					);
			}
		}
	}, [activeTabId, childrenMap, nodes, dispatch, loadChildren]);

	const handleCollapseAll = useCallback(() => {
		dispatch({ type: "COLLAPSE_ALL" });
	}, [dispatch]);

	// ── Bulk actions ────────────────────────────────────────────
	const handleBulkEnable = async (enable: boolean) => {
		if (!canEdit) return;
		const ids = [...multiSelectedIds];
		const results = await Promise.allSettled(
			ids.map((id) => {
				const node = nodes.get(id);
				if (!node || (node.enabled === "1") === enable)
					return Promise.resolve();
				return catalogType === "bc"
					? toggleBcPage({ id, field: "enabled" })
					: toggleCatalogPage({ id, action: "toggleEnabled" });
			}),
		);
		for (const id of ids)
			dispatch({
				type: "UPDATE_NODE",
				update: { id, enabled: enable ? "1" : "0" },
			});
		dispatch({ type: "CLEAR_MULTI_SELECT" });
		const failed = results.filter((r) => r.status === "rejected").length;
		if (failed) toast.error(`${failed} toggle(s) failed`);
		else
			toast.success(`${ids.length} page(s) ${enable ? "enabled" : "disabled"}`);
		onTreeMutation();
	};

	const handleBulkDelete = async () => {
		if (!canEdit) return;
		const ids = [...multiSelectedIds];
		let childTotal = 0;
		let itemTotal = 0;
		for (const id of ids) {
			const node = nodes.get(id);
			if (!node) continue;
			childTotal += node.childCount;
			itemTotal += node.itemCount;
		}
		const childInfo =
			childTotal > 0
				? ` About ${childTotal} child page(s) will be moved to parents.`
				: "";
		const itemInfo =
			itemTotal > 0
				? ` About ${itemTotal} item(s) on selected pages will be deleted.`
				: "";
		const ok = await confirm({
			title: "Delete pages",
			description: `Delete ${ids.length} page(s)?${childInfo}${itemInfo}`,
			confirmLabel: "Delete",
		});
		if (!ok) return;
		const del = catalogType === "bc" ? deleteBcTreePage : deleteTreePage;
		const results = await Promise.allSettled(
			ids.map((id) => del({ pageId: id, mode: "reparent" })),
		);
		const failed = results.filter((r) => r.status === "rejected").length;
		const okCount = ids.length - failed;
		dispatch({ type: "CLEAR_MULTI_SELECT" });
		await loadFullTree();
		if (failed > 0) {
			toast.error(`${failed} delete(s) failed; ${okCount} succeeded`);
		} else {
			toast.success(`${okCount} page(s) deleted`);
		}
		onTreeMutation();
	};

	const activeNode = activeId ? flatItems.find((n) => n.id === activeId) : null;
	const noop = () => {};

	const getItemProps = useCallback(
		(node: FlatTreeNode): Omit<TreeItemProps, "sortMode" | "isOverlay"> => ({
			node,
			isSelected: selectedPageId === node.id,
			isFocused: focusedId === node.id,
			isMultiSelected: multiSelectedIds.has(node.id),
			isAncestorOfSelected: ancestorIds.has(node.id),
			onToggleExpand: handleToggleExpand,
			onSelect: handleSelect,
			onAddSubpage: handleAddSubpage,
			onToggleEnabled: handleToggleEnabled,
			onToggleVisible: handleToggleVisible,
			onDuplicate: handleDuplicate,
			onDelete: handleDelete,
			isLoading: loadingIds.has(node.id),
		}),
		[
			selectedPageId,
			focusedId,
			multiSelectedIds,
			ancestorIds,
			loadingIds,
			handleToggleExpand,
			handleSelect,
			handleDuplicate,
			handleToggleVisible,
			handleDelete,
			handleToggleEnabled,
			handleAddSubpage,
		],
	);

	return (
		<div
			ref={treeRef}
			role="tree"
			tabIndex={0}
			className="flex h-full w-80 shrink-0 flex-col border-r border-[var(--admin-border)]"
			style={{ backgroundColor: "var(--admin-surface)" }}
		>
			{confirmDialog}
			{duplicateSource && (
				<DuplicateCategoryDialog
					source={duplicateSource}
					onClose={() => setDuplicateSource(null)}
					onComplete={() => {
						void loadFullTree();
						onTreeMutation();
					}}
				/>
			)}
			{/* Header */}
			<div className="border-b px-3 py-2 space-y-2 shrink-0">
				{subpageParentId !== null ? (
					<div className="flex items-center gap-1.5 rounded-md border bg-muted/40 p-1.5">
						<Input
							value={subpageName}
							onChange={(e) => setSubpageName(e.target.value)}
							placeholder="Subpage name…"
							autoFocus
							className="h-7 text-sm"
							onKeyDown={(e) => {
								if (e.key === "Enter") void handleCreateSubpage();
								if (e.key === "Escape") {
									setSubpageParentId(null);
									setSubpageName("");
								}
							}}
						/>
						<Button
							type="button"
							size="sm"
							className="h-7 shrink-0 px-2"
							disabled={creatingSubpage || !subpageName.trim()}
							onClick={handleCreateSubpage}
						>
							{creatingSubpage ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Plus className="h-3.5 w-3.5" />
							)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 shrink-0 px-2"
							onClick={() => {
								setSubpageParentId(null);
								setSubpageName("");
							}}
						>
							<X className="h-3.5 w-3.5" />
						</Button>
					</div>
				) : null}
				<div className="flex items-center gap-1.5">
					<div className="relative flex-1">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
						<Input
							ref={searchInputRef}
							placeholder="Search...  /"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="h-7 pl-7 pr-7 text-sm"
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									setSearchQuery("");
									setSearchResults(null);
									searchInputRef.current?.blur();
								}
							}}
						/>
						{searching ? (
							<Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
						) : searchQuery ? (
							<button
								type="button"
								onClick={() => {
									setSearchQuery("");
									setSearchResults(null);
								}}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						) : null}
					</div>
					{canEdit && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant={sortMode ? "default" : "outline"}
									size="icon"
									className="h-7 w-7 shrink-0"
									onClick={() => dispatch({ type: "TOGGLE_SORT_MODE" })}
								>
									{sortMode ? (
										<GripVertical className="h-3.5 w-3.5" />
									) : (
										<MousePointer className="h-3.5 w-3.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>{sortMode ? "Sort mode" : "Edit mode"}</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Filters + expand/collapse */}
				<div className="flex items-center gap-1.5">
					{/* Status filter */}
					<div className="flex items-center rounded-md border bg-muted/30 p-0.5">
						{(["all", "enabled", "disabled"] as FilterMode[]).map((f) => (
							<button
								type="button"
								key={f}
								onClick={() => setFilter(f)}
								className={cn(
									"flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
									filter === f
										? "bg-background shadow-sm text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{f === "enabled" && <ToggleRight className="h-2.5 w-2.5" />}
								{f === "disabled" && <ToggleLeft className="h-2.5 w-2.5" />}
								{f === "all" ? "All" : f === "enabled" ? "On" : "Off"}
							</button>
						))}
					</div>

					<div className="ml-auto flex items-center gap-0.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6"
									onClick={handleExpandAll}
								>
									<ChevronsUpDown className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>Expand all</p>
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6"
									onClick={handleCollapseAll}
								>
									<ChevronsDownUp className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>Collapse all</p>
							</TooltipContent>
						</Tooltip>
						{activeTabId && !searchResults && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6"
										onClick={() => handleAddSubpage(activeTabId)}
									>
										<Plus className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<p>New subpage</p>
								</TooltipContent>
							</Tooltip>
						)}
					</div>
				</div>

				{/* Counter + sort badge */}
				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="text-[9px] h-4 px-1">
						{flatItems.length}
						{totalNodes > 0 && flatItems.length !== totalNodes
							? ` / ${totalNodes}`
							: ""}{" "}
						pages
					</Badge>
					{sortMode && (
						<Badge variant="default" className="text-[9px] h-4 px-1">
							Sort mode
						</Badge>
					)}
				</div>
			</div>

			{/* Tree body (virtualized) */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto">
				{treeLoading ? (
					<div className="space-y-1 p-2" aria-hidden="true">
						{[...Array(8)].map((_, i) => (
							<div
								key={`skeleton-${i}`}
								className="flex items-center gap-2 rounded-md px-2 py-1.5"
								style={{ marginLeft: `${(i % 3) * 14}px` }}
							>
								<div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
								<div
									className="h-3 animate-pulse rounded bg-muted"
									style={{ width: `${55 + ((i * 13) % 35)}%` }}
								/>
							</div>
						))}
					</div>
				) : searchResults !== null ? (
					<div className="p-1">
						<p className="px-2 py-1 text-xs text-muted-foreground">
							{searchResults.length} result
							{searchResults.length !== 1 ? "s" : ""}
						</p>
						{flatItems.map((node) => (
							<div key={node.id} className="py-px">
								<TreeItemContent {...getItemProps(node)} sortMode={false} />
							</div>
						))}
					</div>
				) : flatItems.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
						<FolderOpen className="h-8 w-8 text-muted-foreground/40" />
						<p className="text-xs font-medium text-muted-foreground">
							No pages in this category
						</p>
						<p className="max-w-[200px] text-[10px] text-muted-foreground/70">
							Create a page with the + button, or switch to sort mode to reorder
							existing ones.
						</p>
					</div>
				) : sortMode ? (
					/* Sort mode: dnd-kit enabled, but only for visible virtual items */
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={flatIds}
							strategy={verticalListSortingStrategy}
						>
							<div
								style={{
									height: virtualizer.getTotalSize(),
									position: "relative",
								}}
							>
								{virtualizer.getVirtualItems().map((vItem) => {
									const node = flatItems[vItem.index];
									return (
										<div
											key={node.id}
											style={{
												position: "absolute",
												top: vItem.start,
												width: "100%",
												height: vItem.size,
											}}
										>
											<SortableTreeItem
												{...getItemProps(node)}
												sortMode={true}
											/>
										</div>
									);
								})}
							</div>
						</SortableContext>
						<DragOverlay>
							{activeNode && (
								<TreeItemContent
									node={{ ...activeNode, depth: 0 }}
									sortMode={true}
									isSelected={false}
									isFocused={false}
									isMultiSelected={false}
									isOverlay
									onToggleExpand={noop}
									onSelect={noop}
									onAddSubpage={noop}
									onToggleEnabled={noop}
									onToggleVisible={noop}
									onDuplicate={noop}
									onDelete={noop}
								/>
							)}
						</DragOverlay>
					</DndContext>
				) : (
					/* Normal mode: virtualized, no dnd-kit overhead */
					<div
						style={{ height: virtualizer.getTotalSize(), position: "relative" }}
					>
						{virtualizer.getVirtualItems().map((vItem) => {
							const node = flatItems[vItem.index];
							return (
								<div
									key={node.id}
									style={{
										position: "absolute",
										top: vItem.start,
										width: "100%",
										height: vItem.size,
									}}
								>
									<TreeItemContent {...getItemProps(node)} sortMode={false} />
								</div>
							);
						})}
					</div>
				)}
				{flatItems.length === 0 &&
					!treeLoading &&
					!searchResults &&
					activeTabId && (
						<p className="text-sm text-muted-foreground text-center py-8">
							No subpages. Click + to create one.
						</p>
					)}
			</div>

			{/* Floating multi-select action bar */}
			{multiSelectedIds.size > 0 && (
				<div className="border-t bg-muted/50 px-3 py-2 flex items-center gap-2 shrink-0 flex-wrap">
					<Badge variant="secondary" className="text-[10px]">
						{multiSelectedIds.size} selected
					</Badge>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-[11px] px-2"
						onClick={() => handleBulkEnable(true)}
					>
						<Power className="mr-1 h-3 w-3" /> Enable
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-[11px] px-2"
						onClick={() => handleBulkEnable(false)}
					>
						<PowerOff className="mr-1 h-3 w-3" /> Disable
					</Button>
					<Button
						size="sm"
						variant="destructive"
						className="h-6 text-[11px] px-2"
						onClick={handleBulkDelete}
					>
						<Trash2 className="mr-1 h-3 w-3" /> Delete
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px] px-2 ml-auto"
						onClick={() => dispatch({ type: "CLEAR_MULTI_SELECT" })}
					>
						Clear
					</Button>
				</div>
			)}
		</div>
	);
}
