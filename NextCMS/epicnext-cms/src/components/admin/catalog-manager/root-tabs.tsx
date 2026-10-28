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
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	Copy,
	Loader2,
	Pencil,
	Plus,
	Power,
	PowerOff,
	Trash2,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
	deleteTreePage,
	reorderCatalogPages,
	toggleCatalogPage,
} from "@/actions/catalog";
import {
	deleteBcTreePage,
	reorderBcCatalogPages,
	toggleBcPage,
} from "@/actions/catalog-bc";
import { CatalogIcon } from "@/components/admin/catalog-tree";
import { useConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { requestCatalogNavigation } from "@/features/catalog/client/use-catalog-navigation";
import { DuplicateCategoryDialog } from "@/features/catalog/components/duplicate-category-dialog";
import type { DuplicateInput } from "@/features/catalog/domain/duplicate";
import { cn } from "@/lib/utils";
import {
	restoreDeletedPage,
	showUndoableDeleteToast,
} from "./undo-page-delete";
import { useCatalogManager } from "./use-catalog-store";

export type { RootTab } from "@/types/catalog";

import type { RootTab } from "@/types/catalog";

interface RootTabsProps {
	tabs: RootTab[];
	activeTabId: number | null;
	onTabClick: (id: number) => void | Promise<void>;
	onEditTab: (id: number) => void | Promise<void>;
	onCreateRoot: (caption: string) => Promise<boolean> | boolean;
	loading?: boolean;
	onMutation?: () => void;
}

export function RootTabs({
	tabs,
	activeTabId,
	onTabClick,
	onEditTab,
	onCreateRoot,
	loading,
	onMutation,
}: RootTabsProps) {
	const { catalogType, canEdit, state } = useCatalogManager();
	const t = useTranslations("pages.admin.catalog.workspace.duplicate");
	const { confirm, dialog: confirmDialog } = useConfirmDialog();
	const [duplicateSource, setDuplicateSource] = useState<DuplicateInput | null>(
		null,
	);
	const [activeDragId, setActiveDragId] = useState<number | null>(null);
	const [creatingRoot, setCreatingRoot] = useState(false);
	const [newRootName, setNewRootName] = useState("");
	const newRootInputRef = useRef<HTMLInputElement>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
	);

	const startCreateRoot = useCallback(() => {
		if (!canEdit) return;
		setCreatingRoot(true);
		setNewRootName("");
		requestAnimationFrame(() => {
			newRootInputRef.current?.focus();
		});
	}, [canEdit]);

	const handleCreateRootSubmit = async () => {
		if (!canEdit || !newRootName.trim()) return;
		try {
			const ok = await onCreateRoot(newRootName.trim());
			if (ok) {
				setCreatingRoot(false);
				setNewRootName("");
			}
		} catch {
			// Keep the input open so the operator can retry.
		}
	};

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveDragId(event.active.id as number);
	}, []);

	const handleDragEnd = useCallback(
		async (event: DragEndEvent) => {
			const { active, over } = event;
			setActiveDragId(null);
			if (!over || active.id === over.id) return;

			const oldIndex = tabs.findIndex((t) => t.id === active.id);
			const newIndex = tabs.findIndex((t) => t.id === over.id);
			if (oldIndex === -1 || newIndex === -1) return;

			if (!canEdit || !requestCatalogNavigation()) return;
			const newOrder = arrayMove(tabs, oldIndex, newIndex);

			// Batch reorder
			try {
				const reorder =
					catalogType === "bc" ? reorderBcCatalogPages : reorderCatalogPages;
				const result = await reorder({
					parentId: -1,
					ids: newOrder.map((tab) => tab.id),
					expectedIds: tabs.map((tab) => tab.id),
				});
				if (!result.ok) throw Error("Failed to reorder tabs");
				toast.success("Tabs reordered");
				onMutation?.();
			} catch {
				toast.error("Failed to reorder tabs");
			}
		},
		[tabs, canEdit, catalogType, onMutation],
	);

	const handleToggle = async (tab: RootTab) => {
		if (!canEdit) return;
		try {
			if (catalogType === "bc") {
				await toggleBcPage({ id: tab.id, field: "enabled" });
			} else {
				await toggleCatalogPage({ id: tab.id, action: "toggleEnabled" });
			}
			toast.success(
				`${tab.caption} ${tab.enabled === "1" ? "disabled" : "enabled"}`,
			);
			onMutation?.();
		} catch {
			toast.error("Failed to toggle");
		}
	};

	const handleDelete = async (tab: RootTab) => {
		if (!canEdit) return;
		const snapshot = {
			caption: tab.caption,
			parentId: -1,
			iconImage: tab.iconImage,
			enabled: tab.enabled,
			orderNum: tab.orderNum,
		};
		const ok = await confirm({
			title: "Delete root page",
			description: `Delete root page "${tab.caption}"? Child pages (if any) will be moved to root; items on this page will be deleted.`,
			confirmLabel: "Delete",
		});
		if (!ok) return;
		try {
			if (catalogType === "bc") {
				await deleteBcTreePage({ pageId: tab.id, mode: "reparent" });
			} else {
				await deleteTreePage({ pageId: tab.id, mode: "reparent" });
			}
			onMutation?.();
			showUndoableDeleteToast(`Page "${tab.caption}" deleted`, async () => {
				const newId = await restoreDeletedPage(catalogType, snapshot);
				if (!newId) {
					toast.error("Could not restore page");
					return;
				}
				onMutation?.();
				void onTabClick(newId);
			});
		} catch {
			toast.error("Failed to delete");
		}
	};

	const draggedTab = activeDragId
		? tabs.find((t) => t.id === activeDragId)
		: null;

	return (
		<div
			className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--admin-border)] px-2 py-1.5"
			style={{ backgroundColor: "var(--admin-surface)" }}
		>
			{confirmDialog}
			{duplicateSource && (
				<DuplicateCategoryDialog
					source={duplicateSource}
					onClose={() => setDuplicateSource(null)}
					onComplete={() => onMutation?.()}
				/>
			)}
			{loading && (
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-2" />
			)}
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={tabs.map((t) => t.id)}
					strategy={horizontalListSortingStrategy}
				>
					{tabs.map((tab) => (
						<SortableRootTab
							key={tab.id}
							tab={tab}
							isActive={activeTabId === tab.id}
							onClick={() => onTabClick(tab.id)}
							onEdit={() => onEditTab(tab.id)}
							onToggle={() => handleToggle(tab)}
							onDelete={() => handleDelete(tab)}
							onDuplicate={() => {
								if (state.editorDirty) {
									toast.error(t("draftBlocked"));
									return;
								}
								if (canEdit && requestCatalogNavigation())
									setDuplicateSource({
										kind: catalogType,
										sourceId: tab.id,
										parentId: -1,
										name: `${tab.caption.slice(0, 121)} (copy)`,
									});
							}}
						/>
					))}
				</SortableContext>
				<DragOverlay>
					{draggedTab && (
						<TabButton
							tab={draggedTab}
							isActive={activeTabId === draggedTab.id}
							isOverlay
						/>
					)}
				</DragOverlay>
			</DndContext>
			{canEdit && !creatingRoot && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0 ml-1"
					title="New root page"
					onClick={startCreateRoot}
				>
					<Plus className="h-3.5 w-3.5" />
				</Button>
			)}
			{canEdit && creatingRoot && (
				<div className="ml-1 flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/40 p-1">
					<Input
						ref={newRootInputRef}
						value={newRootName}
						onChange={(e) => setNewRootName(e.target.value)}
						placeholder="Root page name…"
						className="h-7 w-40 text-sm"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void handleCreateRootSubmit();
							}
							if (e.key === "Escape") {
								e.preventDefault();
								setCreatingRoot(false);
								setNewRootName("");
							}
						}}
					/>
					<Button
						type="button"
						size="sm"
						className="h-7 shrink-0 px-2"
						disabled={!newRootName.trim()}
						onClick={() => void handleCreateRootSubmit()}
					>
						<Plus className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 shrink-0 px-2"
						onClick={() => {
							setCreatingRoot(false);
							setNewRootName("");
						}}
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
}

// ── Sortable root tab ─────────────────────────────────────────

function SortableRootTab({
	tab,
	isActive,
	onClick,
	onEdit,
	onToggle,
	onDelete,
	onDuplicate,
}: {
	tab: RootTab;
	isActive: boolean;
	onClick: () => void;
	onEdit: () => void;
	onToggle: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: tab.id,
	});

	const t = useTranslations("pages.admin.catalog.workspace.duplicate");
	const { canEdit } = useCatalogManager();
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.3 : 1,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div ref={setNodeRef} style={style} {...attributes} {...listeners}>
					<TabButton
						tab={tab}
						isActive={isActive}
						onClick={onClick}
						onDoubleClick={onEdit}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-44">
				{canEdit && (
					<ContextMenuItem onClick={onDuplicate}>
						<Copy className="mr-2 h-3.5 w-3.5" />
						{t("title")}
					</ContextMenuItem>
				)}
				<ContextMenuItem onClick={onEdit}>
					<Pencil className="mr-2 h-3.5 w-3.5" />
					Edit page
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onClick={onToggle}>
					{tab.enabled === "1" ? (
						<PowerOff className="mr-2 h-3.5 w-3.5" />
					) : (
						<Power className="mr-2 h-3.5 w-3.5" />
					)}
					{tab.enabled === "1" ? "Disable" : "Enable"}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					className="text-destructive focus:text-destructive"
					onClick={onDelete}
				>
					<Trash2 className="mr-2 h-3.5 w-3.5" />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

// ── Tab button render ─────────────────────────────────────────

function TabButton({
	tab,
	isActive,
	isOverlay,
	onClick,
	onDoubleClick,
}: {
	tab: RootTab;
	isActive: boolean;
	isOverlay?: boolean;
	onClick?: () => void;
	onDoubleClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			className={cn(
				"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0",
				isActive
					? "bg-primary text-primary-foreground shadow-sm"
					: "hover:bg-accent text-muted-foreground hover:text-foreground",
				tab.enabled !== "1" && "opacity-50",
				isOverlay && "bg-card shadow-lg border",
			)}
		>
			<CatalogIcon iconImage={tab.iconImage} size={16} />
			<span className="max-w-32 truncate">{tab.caption}</span>
		</button>
	);
}
