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
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowRightLeft,
	Copy,
	DollarSign,
	GripVertical,
	LayoutGrid,
	Loader2,
	MoveRight,
	Pencil,
	Plus,
	RotateCcw,
	Rows3,
	Save,
	Trash2,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createCatalogItem,
	deleteCatalogItems,
	moveCatalogItems,
	reorderCatalogItems,
	restoreDeletedCatalogItems,
	updateCatalogItem,
	updateCatalogItemsBulk,
} from "@/actions/catalog-items";
import { BulkImportItems } from "@/components/admin/catalog/bulk-import-items";
import { ItemsShopPreview } from "@/components/admin/catalog/items-shop-preview";
import { QuickAddFurni } from "@/components/admin/catalog/quick-add-furni";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { SearchInput } from "@/components/admin/search-input";
import {
	CurrencyIcon,
	currencyKindFromPointsType,
} from "@/components/shared/currency-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { refreshCatalogTree } from "@/features/catalog/client/use-live-catalog";
import { BulkOfferEditor } from "@/features/catalog/components/bulk-offer-editor";
import {
	discoverOffers,
	OFFER_FILTERS,
	type OfferFilter,
} from "@/features/catalog/domain/offer-discovery";
import { useServerAction } from "@/hooks/use-server-action";
import { getSuggestions, recordMove } from "@/lib/move-suggestions";
import { cn } from "@/lib/utils";
import { AddItemFormFields } from "./add-item-form-fields";
import {
	InteractionTypeCombobox,
	MovePageCombobox,
	ToggleField,
} from "./field-helpers";
import { FurniIcon } from "./furni-icon";
import { RecentDeletionsPanel } from "./recent-deletions-panel";
import { SongPicker } from "./song-picker";
import {
	type BaseItemData,
	type CatalogItemData,
	DEFAULT_NEW_ITEM,
	getPointsLabel,
	type InlineEdit,
	POINTS_TYPES,
} from "./types";

export type { BaseItemData, CatalogItemData };

// ── Sortable row wrapper (dnd-kit) ─────────────────────────────
function SortableRow({
	id,
	className,
	dataIndex,
	measureRef,
	children,
}: {
	id: number;
	className?: string;
	/** Virtualizer index; forwarded as data-index so measureElement can map it. */
	dataIndex?: number;
	measureRef?: (el: HTMLTableRowElement | null) => void;
	children: (props: {
		dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
	}) => React.ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id,
	});
	const setRefs = useCallback(
		(node: HTMLTableRowElement | null) => {
			setNodeRef(node);
			measureRef?.(node);
		},
		[setNodeRef, measureRef],
	);
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.35 : 1,
	};
	const dragHandleProps = {
		...attributes,
		...listeners,
	} as unknown as React.HTMLAttributes<HTMLDivElement>;
	return (
		<TableRow
			ref={setRefs}
			data-index={dataIndex}
			style={style}
			className={className}
		>
			{children({ dragHandleProps })}
		</TableRow>
	);
}

interface CatalogItemsTableProps {
	initialSearch?: string;
	onDirtyChange?: (dirty: boolean) => void;
	/**
	 * Required, not optional: every mutation here has to end in a refresh of the
	 * caller's own data. The table used to fall back to `router.refresh()` when
	 * this was omitted, which re-rendered the whole route to redraw one table —
	 * and lost the editor state and scroll position that go with it.
	 */
	onRefresh: () => void;
	items: CatalogItemData[];
	pageId: number;
	pageLayout: string;
	canEdit: boolean;
	interactionTypes: string[];
	furniRevisionMap: Record<number, { classname: string; revision: number }>;
	allPages: { id: number; caption: string }[];
	/** Which catalog these offers belong to; bulk editing follows it. */
	catalog?: "normal" | "bc";
}

export function CatalogItemsTable({
	initialSearch = "",
	onDirtyChange,
	onRefresh,
	items,
	pageId,
	pageLayout,
	canEdit,
	interactionTypes,
	furniRevisionMap,
	allPages,
	catalog = "normal",
}: CatalogItemsTableProps) {
	const bulk = useTranslations("pages.admin.catalog.bulk");
	const discovery = useTranslations("pages.admin.catalog.discovery");
	const t = useTranslations(
		"pages.admin.catalog.catalogItemsTable.catalogItemsTable",
	);
	const [bulkRefreshFrom, setBulkRefreshFrom] = useState<
		CatalogItemData[] | null
	>(null);
	const { run, isPending } = useServerAction();
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	/**
	 * A delete keeps every removed row, so it can be taken back. The affordance
	 * lives in the toast rather than in the toolbar because the window is short:
	 * the audit record outlives it, but a bulk delete is not something to restore
	 * from a dropdown ten minutes later.
	 */
	function offerUndoDelete(restoreId: number, count: number) {
		if (!Number.isSafeInteger(restoreId) || restoreId < 1) return;
		// The panel below holds the same records, so a restore missed here is not a
		// lost delete.
		toast.success(`Deleted ${count} item(s).`, {
			action: {
				label: "Undo",
				onClick: () => {
					void restoreDeletedCatalogItems({
						restoreId,
						requestKey: crypto.randomUUID(),
					}).then((result) => {
						onRefresh();
						if (!result.ok)
							toast.error(result.error ?? "Could not restore the items.");
						else toast.success(`Restored ${result.data.restored} item(s).`);
					});
				},
			},
		});
	}
	const [addOpen, setAddOpen] = useState(false);
	const [editingItem, setEditingItem] = useState<CatalogItemData | null>(null);
	const [editingBase, setEditingBase] = useState<BaseItemData | null>(null);
	const [savingItemId, setSavingItemId] = useState<number | null>(null);

	const [newItem, setNewItem] = useState({ ...DEFAULT_NEW_ITEM });

	// ── View mode (table / grid) ────────────────────────────────────
	const [viewMode, setViewMode] = useState<"table" | "grid">("table");

	// ── Search / Filter ─────────────────────────────────────────────
	const [searchQuery, setSearchQuery] = useState(initialSearch);
	const [filters, setFilters] = useState<Record<string, string>>({
		offerFilter: "all",
		clubOnlyFilter: "all",
		haveOfferFilter: "all",
	});

	const { items: filteredItems, counts: filterCounts } = useMemo(
		() => discoverOffers(items, searchQuery, filters),
		[items, searchQuery, filters],
	);
	const hasDiscoveryFilter =
		Boolean(searchQuery.trim()) ||
		Object.values(filters).some((f) => f !== "all");

	// ── Move items dialog ───────────────────────────────────────────
	const [moveOpen, setMoveOpen] = useState(false);
	const [moveTargetPageId, setMoveTargetPageId] = useState<number | null>(null);

	// ── Bulk price dialog ───────────────────────────────────────────
	const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
	const [bulkPriceField, setBulkPriceField] = useState<
		"costCredits" | "costPoints"
	>("costCredits");
	const [bulkPriceMode, setBulkPriceMode] = useState<"set" | "add" | "percent">(
		"set",
	);
	const [bulkPriceValue, setBulkPriceValue] = useState(0);

	// ── Drag & Drop (dnd-kit) ───────────────────────────────────────
	const [activeDragId, setActiveDragId] = useState<number | null>(null);
	const [itemOrder, setItemOrder] = useState<number[]>(items.map((i) => i.id));
	const dndSensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
	);

	const orderedFilteredItems = useMemo(() => {
		if (searchQuery.trim() || Object.values(filters).some((f) => f !== "all"))
			return filteredItems;
		const orderMap = new Map(itemOrder.map((id, idx) => [id, idx]));
		return filteredItems
			.slice()
			.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
	}, [filteredItems, itemOrder, searchQuery, filters]);

	// ── Virtualization (table view) ─────────────────────────────────
	// A page with hundreds of offers used to mount a full <tr> per row, each
	// with several inputs and icons — the single biggest source of lag in the
	// catalog editor. Above the threshold only the visible window (plus a small
	// overscan) is mounted; spacer rows keep the scrollbar honest.
	const VIRTUALIZE_THRESHOLD = 150;
	const scrollRef = useRef<HTMLDivElement>(null);
	const isVirtualized = orderedFilteredItems.length > VIRTUALIZE_THRESHOLD;
	const virtualizer = useVirtualizer({
		count: orderedFilteredItems.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 52,
		overscan: 15,
		enabled: isVirtualized,
	});
	const virtualRows = isVirtualized ? virtualizer.getVirtualItems() : [];

	// ── Selection ────────────────────────────────────────────────────
	const [selected, setSelected] = useState<Set<number>>(new Set());

	const toggleOne = useCallback((id: number) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const allVisibleSelected =
		filteredItems.length > 0 &&
		filteredItems.every((item) => selected.has(item.id));
	const someVisibleSelected = filteredItems.some((item) =>
		selected.has(item.id),
	);
	const toggleAll = useCallback(() => {
		setSelected((previous) => {
			const next = new Set(previous);
			const allSelected = filteredItems.every((item) => previous.has(item.id));
			for (const item of filteredItems) {
				if (allSelected) next.delete(item.id);
				else next.add(item.id);
			}
			return next;
		});
	}, [filteredItems]);
	function updateSearch(query: string) {
		setSearchQuery(query);
		setSelected(new Set());
	}
	function updateFilter(key: string, value: string) {
		setFilters((prev) => ({ ...prev, [key]: value }));
		setSelected(new Set());
	}
	function resetDiscovery() {
		setSearchQuery("");
		setFilters({
			offerFilter: "all",
			clubOnlyFilter: "all",
			haveOfferFilter: "all",
		});
		setSelected(new Set());
	}

	// ── Inline edits ─────────────────────────────────────────────────
	const [inlineEdits, setInlineEdits] = useState<Record<number, InlineEdit>>(
		Object.fromEntries(
			items.map((item) => [
				item.id,
				{
					costCredits: item.costCredits,
					costPoints: item.costPoints,
					pointsType: item.pointsType,
					amount: item.amount,
				},
			]),
		),
	);

	function updateInline(
		id: number,
		key: keyof InlineEdit,
		value: string | number,
	) {
		setInlineEdits((prev) => ({
			...prev,
			[id]: { ...prev[id], [key]: value },
		}));
	}

	const isItemModified = useCallback(
		(item: CatalogItemData) => {
			const edit = inlineEdits[item.id];
			if (!edit) return false;
			return (
				edit.costCredits !== item.costCredits ||
				edit.costPoints !== item.costPoints ||
				edit.pointsType !== item.pointsType ||
				edit.amount !== item.amount
			);
		},
		[inlineEdits],
	);

	const modifiedItems = useMemo(
		() => items.filter(isItemModified),
		[items, isItemModified],
	);

	const hasOrderChanges = useMemo(() => {
		const originalOrder = items.map((i) => i.id);
		return itemOrder.some((id, idx) => id !== originalOrder[idx]);
	}, [items, itemOrder]);

	const hasUnsavedChanges =
		bulkRefreshFrom === null && (modifiedItems.length > 0 || hasOrderChanges);
	useEffect(() => {
		if (bulkRefreshFrom === null || items === bulkRefreshFrom) return;
		setInlineEdits(
			Object.fromEntries(
				items.map((item) => [
					item.id,
					{
						costCredits: item.costCredits,
						costPoints: item.costPoints,
						pointsType: item.pointsType,
						amount: item.amount,
					},
				]),
			),
		);
		setItemOrder(items.map((item) => item.id));
		setBulkRefreshFrom(null);
	}, [items, bulkRefreshFrom]);
	useEffect(() => {
		onDirtyChange?.(hasUnsavedChanges);
	}, [hasUnsavedChanges, onDirtyChange]);

	// Warn before navigating away with unsaved changes
	useEffect(() => {
		if (!hasUnsavedChanges) return;
		function onBeforeUnload(e: BeforeUnloadEvent) {
			e.preventDefault();
		}
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [hasUnsavedChanges]);

	// Ctrl+S / Cmd+S to save modified items
	useEffect(() => {
		if (!canEdit) return;
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				if (modifiedItems.length > 0) handleSaveAllModified();
				else if (hasOrderChanges) handleSaveOrder();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	function resetInlineEdit(id: number) {
		const item = items.find((i) => i.id === id);
		if (!item) return;
		setInlineEdits((prev) => ({
			...prev,
			[id]: {
				costCredits: item.costCredits,
				costPoints: item.costPoints,
				pointsType: item.pointsType,
				amount: item.amount,
			},
		}));
	}

	function resetAllEdits() {
		setInlineEdits(
			Object.fromEntries(
				items.map((item) => [
					item.id,
					{
						costCredits: item.costCredits,
						costPoints: item.costPoints,
						pointsType: item.pointsType,
						amount: item.amount,
					},
				]),
			),
		);
	}

	// ── Open edit dialog ───────────────────────────────────────────
	function openEditDialog(item: CatalogItemData) {
		setEditingItem({ ...item });
		setEditingBase(item.baseItem ? { ...item.baseItem } : null);
	}

	// ── Save single item inline ──────────────────────────────────────
	async function handleSaveOne(item: CatalogItemData) {
		const edit = inlineEdits[item.id];
		if (!edit) return;
		setSavingItemId(item.id);

		run(
			() =>
				updateCatalogItem({
					id: item.id,
					catalog,
					catalogFields: {
						catalogName: item.catalogName,
						itemIds: item.itemIds,
						costCredits: edit.costCredits,
						costPoints: edit.costPoints,
						pointsType: edit.pointsType,
						amount: edit.amount,
						limitedSells: item.limitedSells,
						limitedStack: item.limitedStack,
						orderNumber: item.orderNumber,
						offerId: item.offerId,
						haveOffer: item.haveOffer,
						clubOnly: item.clubOnly,
						extradata: item.extradata,
					},
				}),
			{
				successMessage: `Item #${item.id} saved.`,
				errorMessage: `Failed to save item #${item.id}.`,
				onSuccess: () => {
					setSavingItemId(null);
					onRefresh();
				},
				onError: () => setSavingItemId(null),
			},
		);
	}

	// ── Save all modified items ──────────────────────────────────────
	async function handleSaveAllModified() {
		if (modifiedItems.length === 0) return;

		const updates = modifiedItems.flatMap((item) => {
			const edit = inlineEdits[item.id];
			if (!edit) return [];
			return [
				{
					id: item.id,
					catalogFields: {
						catalogName: item.catalogName,
						itemIds: item.itemIds,
						costCredits: edit.costCredits,
						costPoints: edit.costPoints,
						pointsType: edit.pointsType,
						amount: edit.amount,
						limitedSells: item.limitedSells,
						limitedStack: item.limitedStack,
						orderNumber: item.orderNumber,
						offerId: item.offerId,
						haveOffer: item.haveOffer,
						clubOnly: item.clubOnly,
						extradata: item.extradata,
					},
				},
			];
		});

		run(() => updateCatalogItemsBulk({ updates, catalog }), {
			successMessage: `Saved ${updates.length} item(s).`,
			errorMessage: "Failed to save items.",
			onSuccess: () => onRefresh(),
		});
	}

	// ── Bulk delete selected ─────────────────────────────────────────
	async function handleBulkDelete() {
		if (selected.size === 0) return;
		const ok = await confirm({
			title: "Delete items",
			description: `Delete ${selected.size} selected item(s)?`,
			confirmLabel: "Delete",
		});
		if (!ok) return;

		const ids = [...selected];
		run(
			() =>
				deleteCatalogItems({ ids, requestKey: crypto.randomUUID(), catalog }),
			{
				successMessage: `Deleted ${ids.length} item(s).`,
				errorMessage: "Failed to delete items.",
				onSuccess: (data) => {
					setSelected(new Set());
					onRefresh();
					offerUndoDelete(Number(data.restoreId), ids.length);
				},
			},
		);
	}

	// ── Move selected items to another page ─────────────────────────
	async function handleMoveItems() {
		if (selected.size === 0 || !moveTargetPageId) return;

		// Record move patterns for all selected items
		for (const id of selected) {
			const item = items.find((i) => i.id === id);
			if (item) {
				recordMove({
					interactionType: item.baseItem?.interactionType,
					itemName: item.baseItemName,
					targetPageId: moveTargetPageId,
				});
			}
		}

		run(
			() =>
				moveCatalogItems({
					ids: [...selected],
					targetPageId: moveTargetPageId,
					catalog,
				}),
			{
				successMessage: `Moved ${selected.size} item(s) to page #${moveTargetPageId}.`,
				errorMessage: "Failed to move items.",
				onSuccess: () => {
					setSelected(new Set());
					setMoveOpen(false);
					setMoveTargetPageId(null);
					onRefresh();
				},
			},
		);
	}

	// ── Apply bulk price update to inline edits ────────────────────
	function applyBulkPrice() {
		const targetIds =
			selected.size > 0 ? selected : new Set(filteredItems.map((i) => i.id));
		setInlineEdits((prev) => {
			const next = { ...prev };
			for (const id of targetIds) {
				const edit = next[id];
				if (!edit) continue;
				const currentVal = edit[bulkPriceField];
				let newVal: number;
				if (bulkPriceMode === "set") {
					newVal = bulkPriceValue;
				} else if (bulkPriceMode === "add") {
					newVal = currentVal + bulkPriceValue;
				} else {
					newVal = Math.round(currentVal * (1 + bulkPriceValue / 100));
				}
				next[id] = { ...edit, [bulkPriceField]: Math.max(0, newVal) };
			}
			return next;
		});
		setBulkPriceOpen(false);
		toast.success(
			`Price update applied to ${targetIds.size} item(s). Save to persist.`,
		);
	}

	// ── Drag & Drop handlers (dnd-kit) ──────────────────────────────
	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveDragId(Number(event.active.id));
	}, []);

	const handleDragEnd = useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDragId(null);
		if (!over || active.id === over.id) return;
		setItemOrder((prev) => {
			const fromIdx = prev.indexOf(Number(active.id));
			const toIdx = prev.indexOf(Number(over.id));
			if (fromIdx === -1 || toIdx === -1) return prev;
			return arrayMove(prev, fromIdx, toIdx);
		});
	}, []);

	const handleDragCancel = useCallback(() => {
		setActiveDragId(null);
	}, []);

	async function handleSaveOrder() {
		const orders = itemOrder.map((id, idx) => ({ id, orderNumber: idx + 1 }));

		run(() => reorderCatalogItems({ orders, catalog }), {
			successMessage: "Item order saved.",
			errorMessage: "Failed to save order.",
			onSuccess: () => onRefresh(),
		});
	}

	function resetOrder() {
		setItemOrder(items.map((i) => i.id));
	}

	// Helper to get furni revision info for an item
	function getFurniInfo(item: CatalogItemData) {
		const firstBaseId = item.itemIds
			.split(";")
			.map(Number)
			.find((n) => n > 0);
		if (!firstBaseId) return { classname: item.baseItemName, revision: 0 };
		const furni = furniRevisionMap[firstBaseId];
		return furni
			? {
					classname: furni.classname || item.baseItemName,
					revision: furni.revision,
				}
			: { classname: item.baseItemName, revision: 0 };
	}

	// ── Original CRUD handlers ───────────────────────────────────────
	async function handleAddItem() {
		run(
			() =>
				createCatalogItem(
					{
						...newItem,
						pageId,
						haveOffer: newItem.haveOffer as "0" | "1",
						clubOnly: newItem.clubOnly as "0" | "1",
					},
					catalog,
				),
			{
				successMessage: "Item added.",
				errorMessage: "Failed to add item",
				onSuccess: () => {
					setAddOpen(false);
					setNewItem({ ...DEFAULT_NEW_ITEM });
					onRefresh();
				},
			},
		);
	}

	async function handleDeleteItem(id: number) {
		const ok = await confirm({
			title: "Delete item",
			description: "Delete this catalog item?",
			confirmLabel: "Delete",
		});
		if (!ok) return;
		run(
			() =>
				deleteCatalogItems({
					ids: [id],
					requestKey: crypto.randomUUID(),
					catalog,
				}),
			{
				successMessage: "Item deleted.",
				errorMessage: "Failed to delete item.",
				onSuccess: (data) => {
					onRefresh();
					offerUndoDelete(Number(data.restoreId), 1);
				},
			},
		);
	}

	// ── Move single item to another page ─────────────────────────
	const [moveOneId, setMoveOneId] = useState<number | null>(null);
	const [moveOneTarget, setMoveOneTarget] = useState<number | null>(null);

	// Get the item being moved for suggestions
	const moveOneItem = moveOneId ? items.find((i) => i.id === moveOneId) : null;
	const moveOneSuggestions = useMemo(() => {
		if (!moveOneItem) return [];
		return getSuggestions({
			interactionType: moveOneItem.baseItem?.interactionType,
			itemName: moveOneItem.baseItemName,
		});
	}, [moveOneItem]);

	async function handleMoveSingleItem() {
		if (!moveOneId || !moveOneTarget) return;
		// Record for learning before moving
		if (moveOneItem) {
			recordMove({
				interactionType: moveOneItem.baseItem?.interactionType,
				itemName: moveOneItem.baseItemName,
				targetPageId: moveOneTarget,
			});
		}
		run(
			() =>
				moveCatalogItems({
					ids: [moveOneId],
					targetPageId: moveOneTarget,
					catalog,
				}),
			{
				successMessage: `Item #${moveOneId} moved to page #${moveOneTarget}.`,
				errorMessage: "Failed to move item.",
				onSuccess: () => {
					setMoveOneId(null);
					setMoveOneTarget(null);
					onRefresh();
				},
			},
		);
	}

	async function handleDuplicateItem(item: CatalogItemData) {
		run(
			() =>
				createCatalogItem(
					{
						pageId,
						itemIds: item.itemIds,
						catalogName: item.catalogName,
						costCredits: item.costCredits,
						costPoints: item.costPoints,
						pointsType: item.pointsType,
						amount: item.amount,
						limitedSells: 0,
						limitedStack: item.limitedStack,
						orderNumber: item.orderNumber + 1,
						offerId: item.offerId,
						songId: item.songId,
						haveOffer: item.haveOffer as "0" | "1",
						clubOnly: item.clubOnly as "0" | "1",
						extradata: item.extradata,
					},
					catalog,
				),
			{
				successMessage: `Item #${item.id} duplicated.`,
				errorMessage: "Failed to duplicate item.",
				onSuccess: () => onRefresh(),
			},
		);
	}

	async function handleUpdateItem() {
		if (!editingItem) return;
		run(
			() =>
				updateCatalogItem({
					id: editingItem.id,
					catalog,
					catalogFields: {
						catalogName: editingItem.catalogName,
						itemIds: editingItem.itemIds,
						costCredits: editingItem.costCredits,
						costPoints: editingItem.costPoints,
						pointsType: editingItem.pointsType,
						amount: editingItem.amount,
						limitedSells: editingItem.limitedSells,
						limitedStack: editingItem.limitedStack,
						orderNumber: editingItem.orderNumber,
						offerId: editingItem.offerId,
						songId: editingItem.songId,
						haveOffer: editingItem.haveOffer,
						clubOnly: editingItem.clubOnly,
						extradata: editingItem.extradata,
					},
					...(editingBase
						? {
								baseItem: {
									id: editingBase.id,
									fields: editingBase as unknown as Record<string, unknown>,
								},
							}
						: {}),
				}),
			{
				successMessage: `Item #${editingItem.id} updated.`,
				errorMessage: "Failed to update item",
				onSuccess: () => {
					setEditingItem(null);
					setEditingBase(null);
					onRefresh();
				},
			},
		);
	}

	// ── Add Item Form Fields (for "Add" dialog) ───────────────────

	return (
		<>
			{confirmDialog}
			{canEdit && (
				<details className="mb-3">
					<summary className="cursor-pointer text-sm text-[var(--admin-text-muted)]">
						Recent deletions
					</summary>
					<div className="mt-2">
						<RecentDeletionsPanel onRestored={onRefresh} />
					</div>
				</details>
			)}
			{bulkRefreshFrom !== null && (
				<p
					role="status"
					className="flex items-center gap-2 text-sm text-muted-foreground"
				>
					<Loader2 className="size-4 animate-spin" />
					{bulk("refreshing")}
				</p>
			)}
			<Card
				inert={bulkRefreshFrom !== null}
				aria-busy={bulkRefreshFrom !== null}
			>
				<CardHeader className="space-y-3">
					<div className="flex flex-row items-center justify-between gap-4">
						<div className="min-w-0">
							<CardTitle>
								{t("itemsCount", { count: items.length })}
								{hasDiscoveryFilter &&
									filteredItems.length !== items.length && (
										<span className="text-muted-foreground font-normal text-sm ml-2">
											{discovery("shown", { count: filteredItems.length })}
										</span>
									)}
							</CardTitle>
							{selected.size > 0 && (
								<p className="text-sm text-muted-foreground mt-1">
									{discovery("selected", { count: selected.size })}
								</p>
							)}
						</div>
						<div className="flex gap-2 flex-shrink-0 flex-wrap justify-end items-center">
							{/* View toggle */}
							<div className="flex items-center rounded-md border bg-muted/30 p-0.5">
								<button
									type="button"
									onClick={() => setViewMode("table")}
									className={cn(
										"flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
										viewMode === "table"
											? "bg-background shadow-sm text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
									title="Table view"
								>
									<Rows3 className="h-3.5 w-3.5" />
									Table
								</button>
								<button
									type="button"
									onClick={() => setViewMode("grid")}
									className={cn(
										"flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
										viewMode === "grid"
											? "bg-background shadow-sm text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
									title="Shop preview"
								>
									<LayoutGrid className="h-3.5 w-3.5" />
									Preview
								</button>
							</div>
							{canEdit && (
								<>
									{selected.size > 0 && (
										<>
											<BulkOfferEditor
												ids={[...selected]}
												allPages={allPages}
												catalog={catalog}
												disabled={
													hasUnsavedChanges ||
													isPending ||
													savingItemId !== null
												}
												onApplied={() => {
													setBulkRefreshFrom(items);
													setSelected(new Set());
													onRefresh();
												}}
											/>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setMoveOpen(true)}
												disabled={isPending}
											>
												<ArrowRightLeft className="mr-2 h-4 w-4" />
												Move ({selected.size})
											</Button>
											<Button
												variant="destructive"
												size="sm"
												onClick={handleBulkDelete}
												disabled={isPending}
											>
												<Trash2 className="mr-2 h-4 w-4" />
												Delete ({selected.size})
											</Button>
										</>
									)}
									<Button
										variant="outline"
										size="sm"
										onClick={() => setBulkPriceOpen(true)}
										disabled={isPending}
									>
										<DollarSign className="mr-2 h-4 w-4" />
										Bulk Price
									</Button>
									{hasOrderChanges && (
										<>
											<Button
												variant="outline"
												size="sm"
												onClick={resetOrder}
												disabled={isPending}
											>
												<RotateCcw className="mr-2 h-4 w-4" />
												Reset Order
											</Button>
											<Button
												size="sm"
												onClick={handleSaveOrder}
												disabled={isPending}
											>
												{isPending ? (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												) : (
													<Save className="mr-2 h-4 w-4" />
												)}
												Save Order
											</Button>
										</>
									)}
									{modifiedItems.length > 0 && (
										<>
											<Button
												variant="outline"
												size="sm"
												onClick={resetAllEdits}
												disabled={isPending}
											>
												<RotateCcw className="mr-2 h-4 w-4" />
												Reset
											</Button>
											<Button
												size="sm"
												onClick={handleSaveAllModified}
												disabled={isPending}
											>
												{isPending ? (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												) : (
													<Save className="mr-2 h-4 w-4" />
												)}
												Save All ({modifiedItems.length})
											</Button>
										</>
									)}
									<QuickAddFurni
										pageId={pageId}
										furniRevisionMap={furniRevisionMap}
									/>
									<BulkImportItems
										pageId={pageId}
										onImported={() => {
											onRefresh();
											void refreshCatalogTree();
										}}
									/>
									<Dialog open={addOpen} onOpenChange={setAddOpen}>
										<Button size="sm" onClick={() => setAddOpen(true)}>
											<Plus className="mr-2 h-4 w-4" />
											Add Item
										</Button>
										<DialogContent className="max-h-[90vh] overflow-y-auto">
											<DialogHeader>
												<DialogTitle>Add Catalog Item</DialogTitle>
											</DialogHeader>
											<AddItemFormFields
												data={newItem}
												onChange={(key, value) =>
													setNewItem((p) => ({ ...p, [key]: value }))
												}
											/>
											<Button
												onClick={handleAddItem}
												disabled={isPending}
												className="w-full"
											>
												{isPending ? (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												) : (
													<Plus className="mr-2 h-4 w-4" />
												)}
												Add Item
											</Button>
										</DialogContent>
									</Dialog>
								</>
							)}
						</div>
					</div>

					{/* Unsaved changes banner */}
					{hasUnsavedChanges && (
						<div className="flex items-center gap-2 rounded-md border border-[var(--admin-warning-border)] bg-[var(--admin-warning-subtle)] px-3 py-2 text-sm text-[var(--admin-warning)]">
							<span className="flex-1">
								You have unsaved changes (
								{modifiedItems.length > 0
									? `${modifiedItems.length} item(s) modified`
									: ""}
								{modifiedItems.length > 0 && hasOrderChanges ? ", " : ""}
								{hasOrderChanges ? "order changed" : ""}). Press{" "}
								<kbd className="rounded border bg-background px-1 font-mono text-xs">
									Ctrl+S
								</kbd>{" "}
								to save.
							</span>
						</div>
					)}

					{/* Offer discovery */}
					{items.length > 0 && (
						<div className="space-y-2">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<div className="min-w-0 flex-1">
									<SearchInput
										placeholder={discovery("searchPlaceholder")}
										value={searchQuery}
										onChange={updateSearch}
										onClear={() => updateSearch("")}
									/>
								</div>
								<Select
									value={filters.offerFilter}
									onValueChange={(v) => updateFilter("offerFilter", v)}
								>
									<SelectTrigger
										aria-label={discovery("filterLabel")}
										className="w-full sm:w-52"
									>
										<SelectValue>
											{discovery(`filters.${filters.offerFilter}`)} (
											{filterCounts[filters.offerFilter as OfferFilter]})
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{OFFER_FILTERS.slice(0, 5).map((filter) => (
											<SelectItem key={filter} value={filter}>
												{discovery(`filters.${filter}`)} ({filterCounts[filter]}
												)
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Select
									value={filters.clubOnlyFilter}
									onValueChange={(v) => updateFilter("clubOnlyFilter", v)}
								>
									<SelectTrigger
										aria-label={discovery("clubOnlyFilterLabel")}
										className="w-full sm:w-52"
									>
										<SelectValue>
											{discovery(`filters.${filters.clubOnlyFilter}`)} (
											{filterCounts[filters.clubOnlyFilter as OfferFilter]})
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											{discovery("filters.all")}
										</SelectItem>
										<SelectItem value="club_only_yes">
											{discovery("filters.club_only_yes")}
										</SelectItem>
										<SelectItem value="club_only_no">
											{discovery("filters.club_only_no")}
										</SelectItem>
									</SelectContent>
								</Select>

								<Select
									value={filters.haveOfferFilter}
									onValueChange={(v) => updateFilter("haveOfferFilter", v)}
								>
									<SelectTrigger
										aria-label={discovery("haveOfferFilterLabel")}
										className="w-full sm:w-52"
									>
										<SelectValue>
											{discovery(`filters.${filters.haveOfferFilter}`)} (
											{filterCounts[filters.haveOfferFilter as OfferFilter]})
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											{discovery("filters.all")}
										</SelectItem>
										<SelectItem value="have_offer_yes">
											{discovery("filters.have_offer_yes")}
										</SelectItem>
										<SelectItem value="have_offer_no">
											{discovery("filters.have_offer_no")}
										</SelectItem>
									</SelectContent>
								</Select>

								{hasDiscoveryFilter && (
									<Button variant="ghost" size="sm" onClick={resetDiscovery}>
										{discovery("reset")}
									</Button>
								)}
							</div>
							<p className="text-xs text-muted-foreground">
								{discovery("results", {
									count: filteredItems.length,
									total: items.length,
								})}
								{canEdit && ` ${discovery("selectionHint")}`}
							</p>
						</div>
					)}
				</CardHeader>
				<CardContent>
					{items.length === 0 ? (
						<div className="text-center py-8 space-y-2">
							<p className="text-sm text-muted-foreground">
								No items in this page.
							</p>
							{canEdit && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setAddOpen(true)}
								>
									<Plus className="mr-2 h-4 w-4" />
									Add First Item
								</Button>
							)}
						</div>
					) : filteredItems.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-8">
							{discovery("noResults")}
						</p>
					) : viewMode === "grid" ? (
						<ItemsShopPreview
							items={orderedFilteredItems as CatalogItemData[]}
							furniRevisionMap={furniRevisionMap}
							layout={pageLayout}
							canEdit={canEdit}
							onItemClick={canEdit ? (item) => openEditDialog(item) : undefined}
						/>
					) : (
						<DndContext
							sensors={dndSensors}
							collisionDetection={closestCenter}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDragCancel={handleDragCancel}
						>
							<div
								ref={scrollRef}
								className="rounded-md border overflow-auto max-h-[600px]"
							>
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-background">
										<TableRow>
											{canEdit && <TableHead className="w-[30px] px-1" />}
											{canEdit && (
												<TableHead className="w-[40px] px-2">
													<Checkbox
														checked={allVisibleSelected}
														indeterminate={
															someVisibleSelected && !allVisibleSelected
														}
														onCheckedChange={toggleAll}
														aria-label={discovery("selectVisible")}
													/>
												</TableHead>
											)}
											<TableHead className="w-[50px] px-1" />
											<TableHead className="w-[60px]">ID</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Item IDs</TableHead>
											<TableHead>Item Name</TableHead>
											<TableHead className="min-w-[180px]">Price</TableHead>
											<TableHead className="w-[70px]">Amt</TableHead>
											<TableHead>Status</TableHead>
											{canEdit && (
												<TableHead className="w-[100px]">Actions</TableHead>
											)}
										</TableRow>
									</TableHeader>
									<SortableContext
										items={orderedFilteredItems.map((i) => i.id)}
										strategy={verticalListSortingStrategy}
									>
										<TableBody>
											{isVirtualized && virtualRows.length > 0 && (
												<tr>
													<td
														colSpan={10}
														style={{
															height: virtualRows[0]?.start ?? 0,
															padding: 0,
															border: 0,
														}}
													/>
												</tr>
											)}
											{(isVirtualized
												? virtualRows.map((vr) => ({
														item: orderedFilteredItems[vr.index],
														index: vr.index,
													}))
												: orderedFilteredItems.map((item, index) => ({
														item,
														index,
													}))
											).map(({ item, index }) => {
												if (!item) return null;
												const pts = getPointsLabel(item.pointsType);
												const edit = inlineEdits[item.id];
												const modified = isItemModified(item);
												const isSaving = savingItemId === item.id;
												const furniInfo = getFurniInfo(item);
												const sortableDisabled = !canEdit || hasDiscoveryFilter;
												return (
													<SortableRow
														key={item.id}
														id={item.id}
														dataIndex={index}
														measureRef={
															isVirtualized
																? (el) => {
																		if (el) virtualizer.measureElement(el);
																	}
																: undefined
														}
														className={cn(
															modified &&
																"bg-[var(--admin-warning-subtle)] dark:bg-[var(--admin-warning-subtle)]",
														)}
													>
														{({ dragHandleProps }) => (
															<>
																{canEdit && (
																	<TableCell className="px-1">
																		{!sortableDisabled ? (
																			<div
																				{...dragHandleProps}
																				className="flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
																				title="Drag to reorder"
																			>
																				<GripVertical className="h-4 w-4" />
																			</div>
																		) : (
																			<div className="h-4 w-4" />
																		)}
																	</TableCell>
																)}
																{canEdit && (
																	<TableCell className="px-2">
																		<Checkbox
																			checked={selected.has(item.id)}
																			onCheckedChange={() => toggleOne(item.id)}
																			aria-label={`Select item ${item.id}`}
																		/>
																	</TableCell>
																)}
																<TableCell className="px-1">
																	<FurniIcon
																		classname={furniInfo.classname}
																		revision={furniInfo.revision}
																	/>
																</TableCell>
																<TableCell className="font-mono text-xs">
																	{item.id}
																</TableCell>
																<TableCell className="font-medium text-sm max-w-[180px] truncate">
																	{item.catalogName || (
																		<span className="text-muted-foreground italic">
																			unnamed
																		</span>
																	)}
																</TableCell>
																<TableCell className="font-mono text-xs">
																	{item.itemIds}
																</TableCell>
																<TableCell className="text-xs text-muted-foreground font-mono max-w-[140px] truncate">
																	{item.baseItemName || "-"}
																</TableCell>
																<TableCell>
																	{canEdit ? (
																		<div className="flex items-center gap-1">
																			<Input
																				type="number"
																				value={
																					edit?.costCredits ?? item.costCredits
																				}
																				onChange={(e) =>
																					updateInline(
																						item.id,
																						"costCredits",
																						parseInt(e.target.value, 10) || 0,
																					)
																				}
																				className="h-8 text-xs w-16"
																				disabled={catalog === "bc"}
																				title={
																					catalog === "bc"
																						? "A Builder Club offer has no price of its own"
																						: "Credits"
																				}
																			/>
																			<span className="text-xs text-[var(--admin-warning)]">
																				c
																			</span>
																			<Input
																				type="number"
																				value={
																					edit?.costPoints ?? item.costPoints
																				}
																				onChange={(e) =>
																					updateInline(
																						item.id,
																						"costPoints",
																						parseInt(e.target.value, 10) || 0,
																					)
																				}
																				className="h-8 text-xs w-16"
																				disabled={catalog === "bc"}
																				title={
																					catalog === "bc"
																						? "A Builder Club offer has no price of its own"
																						: "Points"
																				}
																			/>
																			<span className={`text-xs ${pts.color}`}>
																				{pts.label.charAt(0)}
																			</span>
																		</div>
																	) : (
																		<div className="text-xs flex flex-wrap items-center gap-1.5">
																			{item.costCredits > 0 && (
																				<span className="inline-flex items-center gap-0.5 text-[var(--admin-warning)]">
																					<CurrencyIcon
																						kind="credits"
																						size={12}
																					/>
																					{item.costCredits}
																				</span>
																			)}
																			{item.costPoints > 0 && (
																				<span
																					className={`inline-flex items-center gap-0.5 ${pts.color}`}
																				>
																					<CurrencyIcon
																						kind={currencyKindFromPointsType(
																							item.pointsType,
																						)}
																						size={12}
																					/>
																					{item.costPoints}
																				</span>
																			)}
																			{item.costCredits === 0 &&
																				item.costPoints === 0 && (
																					<span className="text-muted-foreground">
																						Free
																					</span>
																				)}
																		</div>
																	)}
																</TableCell>
																<TableCell>
																	{canEdit ? (
																		<Input
																			type="number"
																			value={edit?.amount ?? item.amount}
																			onChange={(e) =>
																				updateInline(
																					item.id,
																					"amount",
																					parseInt(e.target.value, 10) || 1,
																				)
																			}
																			className="h-8 text-xs w-16"
																		/>
																	) : (
																		<span className="text-xs">
																			{item.amount}
																		</span>
																	)}
																</TableCell>
																<TableCell>
																	<div className="flex flex-wrap gap-1">
																		<Badge
																			variant={
																				item.haveOffer === "1"
																					? "default"
																					: "outline"
																			}
																			className="text-xs"
																		>
																			{item.haveOffer === "1"
																				? "Offer"
																				: "No Offer"}
																		</Badge>
																		{item.limitedStack > 0 && (
																			<Badge
																				variant="secondary"
																				className="text-xs"
																			>
																				LTD {item.limitedSells}/
																				{item.limitedStack}
																			</Badge>
																		)}
																		{item.clubOnly === "1" && (
																			<Badge
																				variant="secondary"
																				className="text-xs"
																			>
																				HC
																			</Badge>
																		)}
																	</div>
																</TableCell>
																{canEdit && (
																	<TableCell>
																		<div className="flex gap-1">
																			{modified && (
																				<>
																					<Button
																						variant="ghost"
																						size="icon"
																						className="h-7 w-7 text-[var(--admin-success)]"
																						onClick={() => handleSaveOne(item)}
																						disabled={isSaving || isPending}
																						title="Save this item"
																					>
																						{isSaving ? (
																							<Loader2 className="h-3 w-3 animate-spin" />
																						) : (
																							<Save className="h-3 w-3" />
																						)}
																					</Button>
																					<Button
																						variant="ghost"
																						size="icon"
																						className="h-7 w-7"
																						onClick={() =>
																							resetInlineEdit(item.id)
																						}
																						title="Reset changes"
																					>
																						<RotateCcw className="h-3 w-3" />
																					</Button>
																				</>
																			)}
																			<Button
																				variant="ghost"
																				size="icon"
																				className="h-7 w-7"
																				onClick={() => openEditDialog(item)}
																				title="Edit all fields"
																			>
																				<Pencil className="h-3 w-3" />
																			</Button>
																			<Button
																				variant="ghost"
																				size="icon"
																				className="h-7 w-7"
																				onClick={() =>
																					handleDuplicateItem(item)
																				}
																				disabled={isPending}
																				title="Duplicate item"
																			>
																				<Copy className="h-3 w-3" />
																			</Button>
																			<Button
																				variant="ghost"
																				size="icon"
																				className="h-7 w-7"
																				onClick={() => setMoveOneId(item.id)}
																				disabled={isPending}
																				title="Move to another page"
																			>
																				<MoveRight className="h-3 w-3" />
																			</Button>
																			<Button
																				variant="ghost"
																				size="icon"
																				className="h-7 w-7 text-destructive"
																				onClick={() =>
																					handleDeleteItem(item.id)
																				}
																				disabled={isPending}
																				title="Delete"
																			>
																				<Trash2 className="h-3 w-3" />
																			</Button>
																		</div>
																	</TableCell>
																)}
															</>
														)}
													</SortableRow>
												);
											})}
											{isVirtualized &&
												virtualRows.length > 0 &&
												(() => {
													const last = virtualRows[virtualRows.length - 1];
													const total = virtualizer.getTotalSize();
													if (!last || last.end >= total) return null;
													return (
														<tr>
															<td
																colSpan={10}
																style={{
																	height: total - last.end,
																	padding: 0,
																	border: 0,
																}}
															/>
														</tr>
													);
												})()}
										</TableBody>
									</SortableContext>
								</Table>
							</div>
							<DragOverlay>
								{activeDragId !== null &&
									(() => {
										const dragged = items.find((i) => i.id === activeDragId);
										if (!dragged) return null;
										const info = getFurniInfo(dragged);
										return (
											<div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-lg">
												<FurniIcon
													classname={info.classname}
													revision={info.revision}
												/>
												<div className="min-w-0">
													<p className="truncate text-sm font-medium">
														{dragged.catalogName ||
															dragged.baseName ||
															`#${dragged.id}`}
													</p>
													<p className="font-mono text-[10px] text-muted-foreground">
														#{dragged.id}
													</p>
												</div>
											</div>
										);
									})()}
							</DragOverlay>
						</DndContext>
					)}

					{/* ── Edit Item Dialog (tabbed: Catalog Settings + Furniture Settings) ── */}
					{editingItem && (
						<Dialog
							open={!!editingItem}
							onOpenChange={(open) => {
								if (!open) {
									setEditingItem(null);
									setEditingBase(null);
								}
							}}
						>
							<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
								<DialogHeader>
									<DialogTitle>Edit Item #{editingItem.id}</DialogTitle>
								</DialogHeader>

								{/* Read-only identity fields */}
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
									<div className="space-y-1">
										<Label className="text-xs text-muted-foreground">
											Catalog Name
										</Label>
										<div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
											{editingItem.catalogName || (
												<span className="italic text-muted-foreground">
													unnamed
												</span>
											)}
										</div>
									</div>
									<div className="space-y-1">
										<Label className="text-xs text-muted-foreground">
											Item IDs
										</Label>
										<div className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono">
											{editingItem.itemIds}
										</div>
									</div>
								</div>

								<Tabs defaultValue="catalog" className="w-full">
									<TabsList className="w-full">
										<TabsTrigger value="catalog" className="flex-1">
											Catalog Settings
										</TabsTrigger>
										<TabsTrigger
											value="furniture"
											className="flex-1"
											disabled={!editingBase}
										>
											Furniture Settings
											{!editingBase && (
												<span className="ml-1 text-xs text-muted-foreground">
													(N/A)
												</span>
											)}
										</TabsTrigger>
									</TabsList>

									{/* ── Catalog Settings Tab ── */}
									<TabsContent value="catalog" className="space-y-3 mt-3">
										<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
											<div className="space-y-1">
												<Label className="text-xs">Credits</Label>
												<Input
													type="number"
													value={editingItem.costCredits}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	costCredits:
																		parseInt(e.target.value, 10) || 0,
																},
														)
													}
												/>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Points</Label>
												<Input
													type="number"
													value={editingItem.costPoints}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	costPoints: parseInt(e.target.value, 10) || 0,
																},
														)
													}
												/>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Points Type</Label>
												<Select
													value={String(editingItem.pointsType)}
													onValueChange={(v) =>
														setEditingItem(
															(p) => p && { ...p, pointsType: parseInt(v, 10) },
														)
													}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{Object.entries(POINTS_TYPES).map(
															([val, { label }]) => (
																<SelectItem key={val} value={val}>
																	{label}
																</SelectItem>
															),
														)}
													</SelectContent>
												</Select>
											</div>
										</div>

										<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
											<div className="space-y-1">
												<Label className="text-xs">Amount</Label>
												<Input
													type="number"
													value={editingItem.amount}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	amount: parseInt(e.target.value, 10) || 1,
																},
														)
													}
												/>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Order</Label>
												<Input
													type="number"
													value={editingItem.orderNumber}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	orderNumber:
																		parseInt(e.target.value, 10) || 0,
																},
														)
													}
												/>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Offer ID</Label>
												<Input
													type="number"
													value={editingItem.offerId}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	offerId: parseInt(e.target.value, 10),
																},
														)
													}
												/>
											</div>
										</div>

										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											<div className="space-y-1">
												<Label className="text-xs">Limited Sells</Label>
												<Input
													type="number"
													value={editingItem.limitedSells}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	limitedSells:
																		parseInt(e.target.value, 10) || 0,
																},
														)
													}
												/>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Limited Stack</Label>
												<Input
													type="number"
													value={editingItem.limitedStack}
													onChange={(e) =>
														setEditingItem(
															(p) =>
																p && {
																	...p,
																	limitedStack:
																		parseInt(e.target.value, 10) || 0,
																},
														)
													}
												/>
											</div>
										</div>

										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											<div className="space-y-1">
												<Label className="text-xs">Have Offer</Label>
												<Select
													value={editingItem.haveOffer}
													onValueChange={(v) =>
														setEditingItem((p) => p && { ...p, haveOffer: v })
													}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="1">Yes</SelectItem>
														<SelectItem value="0">No</SelectItem>
													</SelectContent>
												</Select>
											</div>
											<div className="space-y-1">
												<Label className="text-xs">Club Only</Label>
												<Select
													value={editingItem.clubOnly}
													onValueChange={(v) =>
														setEditingItem((p) => p && { ...p, clubOnly: v })
													}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="0">No</SelectItem>
														<SelectItem value="1">Yes</SelectItem>
													</SelectContent>
												</Select>
											</div>
										</div>

										<div className="space-y-1">
											<Label className="text-xs">Extra Data</Label>
											<Input
												value={editingItem.extradata}
												onChange={(e) =>
													setEditingItem(
														(p) => p && { ...p, extradata: e.target.value },
													)
												}
												placeholder="Optional extra data"
											/>
										</div>

										<div className="space-y-1">
											<Label className="text-xs">Song Disk</Label>
											<SongPicker
												value={editingItem.songId}
												onChange={(id) =>
													setEditingItem((p) => p && { ...p, songId: id })
												}
											/>
											<p className="text-xs text-muted-foreground">
												Select a soundtrack to play when this item is used
												in-game. Uploaded from <code>/admin/sounds</code>.
											</p>
										</div>
									</TabsContent>

									{/* ── Furniture Settings Tab (items_base) ── */}
									{editingBase && (
										<TabsContent value="furniture" className="space-y-4 mt-3">
											{/* Identity */}
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
													Identity
												</h4>
												<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
													<div className="space-y-1">
														<Label className="text-xs">Base ID</Label>
														<div className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono">
															{editingBase.id}
														</div>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Sprite ID</Label>
														<Input
															type="number"
															value={editingBase.spriteId}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			spriteId:
																				parseInt(e.target.value, 10) || 0,
																		},
																)
															}
														/>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Type</Label>
														<Select
															value={editingBase.type}
															onValueChange={(v) =>
																setEditingBase((p) => p && { ...p, type: v })
															}
														>
															<SelectTrigger>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="s">s (Floor)</SelectItem>
																<SelectItem value="i">i (Wall)</SelectItem>
																<SelectItem value="e">e (Effect)</SelectItem>
																<SelectItem value="b">b (Badge)</SelectItem>
																<SelectItem value="r">r (Robot)</SelectItem>
																<SelectItem value="h">
																	h (Habbo Club)
																</SelectItem>
																<SelectItem value="p">p (Pet)</SelectItem>
															</SelectContent>
														</Select>
													</div>
												</div>
											</div>

											{/* Dimensions */}
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
													Dimensions
												</h4>
												<div className="grid grid-cols-3 gap-2">
													<div className="space-y-1">
														<Label className="text-xs">Width</Label>
														<Input
															type="number"
															value={editingBase.width}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			width: parseInt(e.target.value, 10) || 0,
																		},
																)
															}
														/>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Length</Label>
														<Input
															type="number"
															value={editingBase.length}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			length: parseInt(e.target.value, 10) || 0,
																		},
																)
															}
														/>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Stack Height</Label>
														<Input
															type="number"
															step="0.01"
															value={editingBase.stackHeight}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			stackHeight:
																				parseFloat(e.target.value) || 0,
																		},
																)
															}
														/>
													</div>
												</div>
											</div>

											{/* Interaction */}
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
													Interaction
												</h4>
												<div className="grid grid-cols-2 gap-2">
													<div className="space-y-1">
														<Label className="text-xs">Interaction Type</Label>
														<InteractionTypeCombobox
															value={editingBase.interactionType}
															onChange={(v) =>
																setEditingBase(
																	(p) => p && { ...p, interactionType: v },
																)
															}
															types={interactionTypes}
														/>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Interaction Modes</Label>
														<Input
															type="number"
															value={editingBase.interactionModesCount}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			interactionModesCount:
																				parseInt(e.target.value, 10) || 0,
																		},
																)
															}
														/>
													</div>
												</div>
											</div>

											{/* Permissions */}
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
													Permissions
												</h4>
												<div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border p-3">
													<ToggleField
														label="Allow Stack"
														value={editingBase.allowStack}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowStack: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Sit"
														value={editingBase.allowSit}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowSit: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Lay"
														value={editingBase.allowLay}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowLay: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Walk"
														value={editingBase.allowWalk}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowWalk: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Gift"
														value={editingBase.allowGift}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowGift: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Trade"
														value={editingBase.allowTrade}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowTrade: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Recycle"
														value={editingBase.allowRecycle}
														onChange={(v) =>
															setEditingBase(
																(p) => p && { ...p, allowRecycle: v ? 1 : 0 },
															)
														}
													/>
													<ToggleField
														label="Allow Marketplace Sell"
														value={editingBase.allowMarketplaceSell}
														onChange={(v) =>
															setEditingBase(
																(p) =>
																	p && {
																		...p,
																		allowMarketplaceSell: v ? 1 : 0,
																	},
															)
														}
													/>
													<ToggleField
														label="Allow Inventory Stack"
														value={editingBase.allowInventoryStack}
														onChange={(v) =>
															setEditingBase(
																(p) =>
																	p && { ...p, allowInventoryStack: v ? 1 : 0 },
															)
														}
													/>
												</div>
											</div>

											{/* Extra */}
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
													Extra
												</h4>
												<div className="space-y-2">
													<div className="grid grid-cols-2 gap-2">
														<div className="space-y-1">
															<Label className="text-xs">Vending IDs</Label>
															<Input
																value={editingBase.vendingIds}
																onChange={(e) =>
																	setEditingBase(
																		(p) =>
																			p && { ...p, vendingIds: e.target.value },
																	)
																}
																placeholder="0"
															/>
														</div>
														<div className="space-y-1">
															<Label className="text-xs">Custom Params</Label>
															<Input
																value={editingBase.customparams}
																onChange={(e) =>
																	setEditingBase(
																		(p) =>
																			p && {
																				...p,
																				customparams: e.target.value,
																			},
																	)
																}
																placeholder=""
															/>
														</div>
													</div>
													<div className="grid grid-cols-2 gap-2">
														<div className="space-y-1">
															<Label className="text-xs">Effect ID Male</Label>
															<Input
																type="number"
																value={editingBase.effectIdMale}
																onChange={(e) =>
																	setEditingBase(
																		(p) =>
																			p && {
																				...p,
																				effectIdMale:
																					parseInt(e.target.value, 10) || 0,
																			},
																	)
																}
															/>
														</div>
														<div className="space-y-1">
															<Label className="text-xs">
																Effect ID Female
															</Label>
															<Input
																type="number"
																value={editingBase.effectIdFemale}
																onChange={(e) =>
																	setEditingBase(
																		(p) =>
																			p && {
																				...p,
																				effectIdFemale:
																					parseInt(e.target.value, 10) || 0,
																			},
																	)
																}
															/>
														</div>
													</div>
													<div className="space-y-1">
														<Label className="text-xs">Clothing On Walk</Label>
														<Input
															value={editingBase.clothingOnWalk}
															onChange={(e) =>
																setEditingBase(
																	(p) =>
																		p && {
																			...p,
																			clothingOnWalk: e.target.value,
																		},
																)
															}
															placeholder=""
														/>
													</div>
												</div>
											</div>
										</TabsContent>
									)}
								</Tabs>

								{/* Action buttons */}
								<div className="flex gap-2 mt-2">
									<Button
										onClick={handleUpdateItem}
										disabled={isPending}
										className="flex-1"
									>
										{isPending ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<Save className="mr-2 h-4 w-4" />
										)}
										Save
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setEditingItem(null);
											setEditingBase(null);
										}}
									>
										<X className="mr-2 h-4 w-4" />
										Cancel
									</Button>
								</div>
							</DialogContent>
						</Dialog>
					)}
					{/* ── Move Items Dialog ── */}
					<Dialog
						open={moveOpen}
						onOpenChange={(open) => {
							if (!open) {
								setMoveOpen(false);
								setMoveTargetPageId(null);
							}
						}}
					>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>
									Move {selected.size} item(s) to another page
								</DialogTitle>
							</DialogHeader>
							<div className="space-y-3">
								<Label>Target Page</Label>
								<MovePageCombobox
									value={moveTargetPageId}
									onChange={setMoveTargetPageId}
									pages={allPages}
									currentPageId={pageId}
								/>
								<div className="flex gap-2">
									<Button
										onClick={handleMoveItems}
										disabled={isPending || !moveTargetPageId}
										className="flex-1"
									>
										{isPending ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<ArrowRightLeft className="mr-2 h-4 w-4" />
										)}
										Move Items
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setMoveOpen(false);
											setMoveTargetPageId(null);
										}}
									>
										Cancel
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>

					{/* ── Move Single Item Dialog ── */}
					<Dialog
						open={moveOneId !== null}
						onOpenChange={(open) => {
							if (!open) {
								setMoveOneId(null);
								setMoveOneTarget(null);
							}
						}}
					>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Move Item to another page</DialogTitle>
							</DialogHeader>
							<div className="space-y-3">
								{/* Item info */}
								{moveOneItem && (
									<div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
										<FurniIcon
											classname={getFurniInfo(moveOneItem).classname}
											revision={getFurniInfo(moveOneItem).revision}
										/>
										<div className="min-w-0">
											<p className="text-sm font-medium truncate">
												{moveOneItem.catalogName || moveOneItem.baseName}
											</p>
											<p className="text-xs text-muted-foreground font-mono">
												#{moveOneItem.id} · {moveOneItem.baseItemName || "—"}
												{moveOneItem.baseItem?.interactionType &&
													` · ${moveOneItem.baseItem.interactionType}`}
											</p>
										</div>
									</div>
								)}
								<Label>Target Page</Label>
								<MovePageCombobox
									value={moveOneTarget}
									onChange={setMoveOneTarget}
									pages={allPages}
									currentPageId={pageId}
									suggestedPageIds={moveOneSuggestions}
								/>
								{moveOneSuggestions.length > 0 && (
									<p className="text-[10px] text-muted-foreground">
										Suggestions based on previous moves for similar items.
									</p>
								)}
								<div className="flex gap-2">
									<Button
										onClick={handleMoveSingleItem}
										disabled={isPending || !moveOneTarget}
										className="flex-1"
									>
										{isPending ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<MoveRight className="mr-2 h-4 w-4" />
										)}
										Move Item
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setMoveOneId(null);
											setMoveOneTarget(null);
										}}
									>
										Cancel
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>

					{/* ── Bulk Price Dialog ── */}
					<Dialog open={bulkPriceOpen} onOpenChange={setBulkPriceOpen}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Bulk Price Update</DialogTitle>
							</DialogHeader>
							<p className="text-sm text-muted-foreground">
								{selected.size > 0
									? `Apply to ${selected.size} selected item(s).`
									: `Apply to all ${filteredItems.length} visible item(s).`}
							</p>
							<div className="space-y-3">
								<div className="space-y-2">
									<Label>Field</Label>
									<Select
										value={bulkPriceField}
										onValueChange={(v) =>
											setBulkPriceField(v as "costCredits" | "costPoints")
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="costCredits">Credits</SelectItem>
											<SelectItem value="costPoints">Points</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label>Operation</Label>
									<Select
										value={bulkPriceMode}
										onValueChange={(v) =>
											setBulkPriceMode(v as "set" | "add" | "percent")
										}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="set">Set to value</SelectItem>
											<SelectItem value="add">Add value</SelectItem>
											<SelectItem value="percent">
												Change by percentage
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label>
										{bulkPriceMode === "percent" ? "Percentage (%)" : "Value"}
									</Label>
									<Input
										type="number"
										value={bulkPriceValue}
										onChange={(e) =>
											setBulkPriceValue(parseFloat(e.target.value) || 0)
										}
										placeholder={
											bulkPriceMode === "percent"
												? "e.g. 10 for +10%"
												: "e.g. 5"
										}
									/>
									{bulkPriceMode === "percent" && (
										<p className="text-xs text-muted-foreground">
											Use negative values to decrease (e.g. -20 for -20%)
										</p>
									)}
									{bulkPriceMode === "add" && (
										<p className="text-xs text-muted-foreground">
											Use negative values to subtract
										</p>
									)}
								</div>
								<div className="flex gap-2">
									<Button onClick={applyBulkPrice} className="flex-1">
										<DollarSign className="mr-2 h-4 w-4" />
										Apply
									</Button>
									<Button
										variant="outline"
										onClick={() => setBulkPriceOpen(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>
		</>
	);
}
