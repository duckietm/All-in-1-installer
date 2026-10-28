"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ChevronRight,
	Copy as CopyIcon,
	Eye,
	EyeOff,
	EyeOff as EyeOffIcon,
	Files,
	GripVertical,
	Loader2,
	Pencil,
	Plus,
	Power,
	PowerOff,
	Trash2,
} from "lucide-react";
import React from "react";
import { CatalogIcon, LAYOUT_COLORS } from "@/components/admin/catalog-tree";
import { Badge } from "@/components/ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { translateCaption } from "@/lib/catalog-translations";
import { cn } from "@/lib/utils";

export interface FlatTreeNode {
	id: number;
	caption: string;
	parentId: number;
	enabled: string;
	visible: string;
	iconImage: number;
	iconColor: number;
	pageLayout: string;
	childCount: number;
	itemCount: number;
	depth: number;
	isExpanded: boolean;
}

export interface TreeItemProps {
	node: FlatTreeNode;
	sortMode: boolean;
	isSelected: boolean;
	isFocused: boolean;
	isMultiSelected: boolean;
	isAncestorOfSelected?: boolean;
	isOverlay?: boolean;
	onToggleExpand: (id: number) => void;
	onSelect: (id: number, e?: React.MouseEvent) => void;
	onAddSubpage: (parentId: number) => void;
	onToggleEnabled: (id: number, currentEnabled: string) => void;
	onToggleVisible: (id: number, currentVisible: string) => void;
	onDuplicate: (id: number) => void;
	onDelete: (id: number) => void;
	isLoading?: boolean;
}

export function SortableTreeItem(props: TreeItemProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: props.node.id,
		disabled: !props.sortMode,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div ref={setNodeRef} style={style}>
			<TreeItemContent
				{...props}
				isDragging={isDragging}
				dragHandleProps={
					props.sortMode ? { ...attributes, ...listeners } : undefined
				}
			/>
		</div>
	);
}

export const TreeItemContent = React.memo(
	function TreeItemContent({
		node,
		sortMode,
		isSelected,
		isFocused,
		isMultiSelected,
		isAncestorOfSelected,
		isOverlay,
		isDragging,
		dragHandleProps,
		onToggleExpand,
		onSelect,
		onAddSubpage,
		onToggleEnabled,
		onToggleVisible,
		onDuplicate,
		onDelete,
		isLoading,
	}: TreeItemProps & {
		isDragging?: boolean;
		dragHandleProps?: Record<string, unknown>;
	}) {
		const isDisabled = node.enabled !== "1";
		const isHidden = node.visible !== "1";
		const italianName = translateCaption(node.caption);
		const layoutColor =
			LAYOUT_COLORS[node.pageLayout] || "bg-muted text-muted-foreground";

		const content = (
			// biome-ignore lint/a11y/useSemanticElements: wrapped by ContextMenuTrigger asChild (Radix); a real <button> would conflict with sortable handle inside
			<div
				role="button"
				tabIndex={sortMode ? -1 : 0}
				className={cn(
					"flex items-center gap-1 rounded-md px-1.5 py-1 group transition-colors",
					!sortMode && "cursor-pointer",
					isSelected && !isDragging && "bg-primary/10 ring-1 ring-primary/30",
					isMultiSelected &&
						!isSelected &&
						!isDragging &&
						"bg-primary/5 ring-1 ring-primary/15",
					isFocused &&
						!isSelected &&
						!isMultiSelected &&
						"ring-2 ring-[var(--admin-focus-ring)]/40",
					!isSelected &&
						!isMultiSelected &&
						!isFocused &&
						!isDragging &&
						"hover:bg-accent/60",
					isAncestorOfSelected &&
						!isSelected &&
						!isMultiSelected &&
						"border-l-2 border-l-primary/30",
					isDisabled && "opacity-40",
					isDragging && "opacity-30",
					isOverlay && "bg-card shadow-lg border opacity-100",
				)}
				style={{ paddingLeft: isOverlay ? 8 : `${node.depth * 20 + 8}px` }}
				onClick={(e) => !sortMode && onSelect(node.id, e)}
				onKeyDown={(e) => {
					if (!sortMode && (e.key === "Enter" || e.key === " ")) {
						e.preventDefault();
						onSelect(node.id, e as unknown as React.MouseEvent);
					}
				}}
			>
				{/* Sort mode grip */}
				{sortMode && (
					<div
						className="flex items-center justify-center h-5 w-5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground"
						{...dragHandleProps}
					>
						<GripVertical className="h-3.5 w-3.5" />
					</div>
				)}

				{/* Expand/collapse */}
				{node.childCount > 0 ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onToggleExpand(node.id);
						}}
						className="flex items-center justify-center h-5 w-5 shrink-0 rounded hover:bg-accent"
					>
						{isLoading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						) : (
							<ChevronRight
								className={cn(
									"h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
									node.isExpanded && "rotate-90",
								)}
							/>
						)}
					</button>
				) : (
					<span className="h-5 w-5 shrink-0" />
				)}

				{/* Icon */}
				<CatalogIcon iconImage={node.iconImage} size={18} />

				{/* Caption */}
				<div className="flex-1 min-w-0">
					<span className="text-sm font-medium truncate block">
						{italianName ?? node.caption}
					</span>
					{italianName && (
						<span className="text-[10px] text-muted-foreground truncate block leading-tight">
							{node.caption}
						</span>
					)}
				</div>

				{/* Status indicators */}
				<div className="flex items-center gap-0.5 shrink-0">
					{isHidden && <EyeOff className="h-3 w-3 text-muted-foreground" />}
					{isDisabled && (
						<Badge variant="destructive" className="h-4 px-1 text-[9px]">
							OFF
						</Badge>
					)}
					{node.itemCount > 0 && (
						<Badge
							variant="secondary"
							className="h-4 px-1 text-[9px] font-mono"
						>
							{node.itemCount}
						</Badge>
					)}
					<Badge
						className={cn(
							"h-4 px-1 text-[8px] font-mono opacity-0 group-hover:opacity-100 transition-opacity border-0",
							layoutColor,
						)}
					>
						{node.pageLayout.replace("default_3x3", "3x3")}
					</Badge>
				</div>
			</div>
		);

		// In sort mode or overlay, no context menu
		if (sortMode || isOverlay) return content;

		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
				<ContextMenuContent className="w-52">
					<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
						<CatalogIcon iconImage={node.iconImage} size={14} />
						{node.caption}
						<span className="text-muted-foreground font-normal ml-auto">
							#{node.id}
						</span>
					</div>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={() => onSelect(node.id)}>
						<Pencil className="mr-2 h-3.5 w-3.5" />
						Edit
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => navigator.clipboard.writeText(String(node.id))}
					>
						<CopyIcon className="mr-2 h-3.5 w-3.5" />
						Copy ID
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={() => onAddSubpage(node.id)}>
						<Plus className="mr-2 h-3.5 w-3.5" />
						Add subpage
					</ContextMenuItem>
					<ContextMenuItem onClick={() => onDuplicate(node.id)}>
						<Files className="mr-2 h-3.5 w-3.5" />
						Duplicate page
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						onClick={() => onToggleEnabled(node.id, node.enabled)}
					>
						{isDisabled ? (
							<Power className="mr-2 h-3.5 w-3.5" />
						) : (
							<PowerOff className="mr-2 h-3.5 w-3.5" />
						)}
						{isDisabled ? "Enable" : "Disable"}
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => onToggleVisible(node.id, node.visible)}
					>
						{isHidden ? (
							<Eye className="mr-2 h-3.5 w-3.5" />
						) : (
							<EyeOffIcon className="mr-2 h-3.5 w-3.5" />
						)}
						{isHidden ? "Show" : "Hide"}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						className="text-destructive focus:text-destructive"
						onClick={() => onDelete(node.id)}
					>
						<Trash2 className="mr-2 h-3.5 w-3.5" />
						Delete
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
	(prev, next) => {
		return (
			prev.onSelect === next.onSelect &&
			prev.node.id === next.node.id &&
			prev.node.caption === next.node.caption &&
			prev.node.enabled === next.node.enabled &&
			prev.node.visible === next.node.visible &&
			prev.node.itemCount === next.node.itemCount &&
			prev.node.isExpanded === next.node.isExpanded &&
			prev.node.depth === next.node.depth &&
			prev.isSelected === next.isSelected &&
			prev.isFocused === next.isFocused &&
			prev.isMultiSelected === next.isMultiSelected &&
			prev.isAncestorOfSelected === next.isAncestorOfSelected &&
			prev.sortMode === next.sortMode &&
			prev.isLoading === next.isLoading &&
			prev.isDragging === next.isDragging
		);
	},
);
