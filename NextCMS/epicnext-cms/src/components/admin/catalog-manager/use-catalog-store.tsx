"use client";

import {
	createContext,
	type Dispatch,
	type ReactNode,
	useContext,
	useReducer,
} from "react";
import type { RootTab, TreeNodeData, TreeNodeUpdate } from "@/types/catalog";

// ── State ─────────────────────────────────────────────────────

export interface CatalogManagerState {
	// Root tabs
	rootPages: RootTab[];
	activeTabId: number | null;
	loadingRoot: boolean;

	// Tree
	nodes: Map<number, TreeNodeData>;
	childrenMap: Map<number, number[]>;
	expandedIds: Set<number>;
	loadingIds: Set<number>;
	selectedPageId: number | null;
	multiSelectedIds: Set<number>;
	focusedId: number | null;
	sortMode: boolean;
	searchQuery: string;
	searchResults: TreeNodeData[] | null;
	searching: boolean;

	// Editor
	editorDirty: boolean;

	// Breadcrumb
	ancestors: Array<{ id: number; caption: string }>;
}

const initialState: CatalogManagerState = {
	rootPages: [],
	activeTabId: null,
	loadingRoot: false,
	nodes: new Map(),
	childrenMap: new Map(),
	expandedIds: new Set(),
	loadingIds: new Set(),
	selectedPageId: null,
	multiSelectedIds: new Set(),
	focusedId: null,
	sortMode: false,
	searchQuery: "",
	searchResults: null,
	searching: false,
	editorDirty: false,
	ancestors: [],
};

// ── Actions ───────────────────────────────────────────────────

export type CatalogAction =
	| { type: "RESTORE_SELECTION"; rootId: number | null; pageId: number | null }
	| { type: "SET_ROOT_PAGES"; pages: RootTab[] }
	| { type: "SET_LOADING_ROOT"; loading: boolean }
	| { type: "SET_ACTIVE_TAB"; id: number | null }
	| { type: "SELECT_PAGE"; id: number | null }
	| { type: "TOGGLE_EXPAND"; id: number }
	| { type: "SET_EXPANDED"; id: number; expanded: boolean }
	| { type: "EXPAND_PATH"; ids: number[] }
	| { type: "COLLAPSE_ALL" }
	| { type: "SET_NODES"; nodes: TreeNodeData[] }
	| { type: "SET_FULL_TREE"; nodes: TreeNodeData[] }
	| { type: "SET_CHILDREN"; parentId: number; children: TreeNodeData[] }
	| { type: "UPDATE_NODE"; update: TreeNodeUpdate }
	| { type: "REMOVE_NODE"; id: number }
	| { type: "SET_LOADING_IDS"; ids: Set<number> }
	| { type: "SET_SEARCH_QUERY"; query: string }
	| { type: "SET_SEARCH_RESULTS"; results: TreeNodeData[] | null }
	| { type: "SET_SEARCHING"; searching: boolean }
	| { type: "TOGGLE_SORT_MODE" }
	| { type: "TOGGLE_MULTI_SELECT"; id: number }
	| { type: "RANGE_SELECT"; from: number; to: number; flatIds: number[] }
	| { type: "CLEAR_MULTI_SELECT" }
	| { type: "SET_FOCUSED"; id: number | null }
	| { type: "SET_DIRTY"; dirty: boolean }
	| { type: "SET_ANCESTORS"; ancestors: Array<{ id: number; caption: string }> }
	| { type: "ON_DIALOG_CLOSE" }
	| { type: "CLEAR_TREE" };

// ── Reducer ───────────────────────────────────────────────────

function reducer(
	state: CatalogManagerState,
	action: CatalogAction,
): CatalogManagerState {
	switch (action.type) {
		case "RESTORE_SELECTION":
			return {
				...state,
				activeTabId:
					action.rootId ?? state.rootPages[0]?.id ?? state.activeTabId,
				selectedPageId: action.pageId,
				focusedId: action.pageId,
				editorDirty: false,
				multiSelectedIds: new Set(),
				ancestors: [],
			};
		case "SET_ROOT_PAGES":
			return {
				...state,
				rootPages: action.pages,
				loadingRoot: false,
				activeTabId: action.pages.some((page) => page.id === state.activeTabId)
					? state.activeTabId
					: (action.pages[0]?.id ?? null),
			};
		case "SET_LOADING_ROOT":
			return { ...state, loadingRoot: action.loading };
		case "SET_ACTIVE_TAB":
			return {
				...state,
				activeTabId: action.id,
				editorDirty: false,
				selectedPageId: null,
				multiSelectedIds: new Set(),
				focusedId: null,
				ancestors: [],
			};
		case "SELECT_PAGE":
			return {
				...state,
				selectedPageId: action.id,
				editorDirty: false,
				multiSelectedIds: new Set(),
				focusedId: action.id,
			};

		case "TOGGLE_EXPAND": {
			const next = new Set(state.expandedIds);
			if (next.has(action.id)) next.delete(action.id);
			else next.add(action.id);
			return { ...state, expandedIds: next };
		}
		case "SET_EXPANDED": {
			const next = new Set(state.expandedIds);
			if (action.expanded) next.add(action.id);
			else next.delete(action.id);
			return { ...state, expandedIds: next };
		}
		case "EXPAND_PATH": {
			const next = new Set(state.expandedIds);
			for (const id of action.ids) next.add(id);
			return { ...state, expandedIds: next };
		}
		case "COLLAPSE_ALL":
			return { ...state, expandedIds: new Set() };

		case "SET_NODES": {
			const next = new Map(state.nodes);
			for (const n of action.nodes) next.set(n.id, n);
			return { ...state, nodes: next };
		}
		case "SET_FULL_TREE": {
			const nodes = new Map<number, TreeNodeData>();
			const childrenMap = new Map<number, number[]>();
			for (const raw of action.nodes) {
				const id = Number(raw.id);
				const parentId = Number(raw.parentId);
				if (!Number.isFinite(id)) continue;
				const n: TreeNodeData = {
					...raw,
					id,
					parentId: Number.isFinite(parentId) ? parentId : -1,
					enabled: String(raw.enabled ?? "0"),
					visible: String(raw.visible ?? "0"),
					childCount: Number(raw.childCount) || 0,
					itemCount: Number(raw.itemCount) || 0,
					iconImage: Number(raw.iconImage) || 0,
					iconColor: Number(raw.iconColor) || 0,
					orderNum: Number(raw.orderNum) || 0,
				};
				nodes.set(id, n);
				const siblings = childrenMap.get(n.parentId) || [];
				siblings.push(id);
				childrenMap.set(n.parentId, siblings);
			}
			// Roots may be parent_id -1 or 0 — mirror both keys so tabs resolve children.
			const underNeg1 = childrenMap.get(-1) || [];
			const under0 = childrenMap.get(0) || [];
			if (underNeg1.length || under0.length) {
				const merged = [...new Set([...underNeg1, ...under0])];
				childrenMap.set(-1, merged);
				childrenMap.set(0, merged);
			}
			for (const [parentId, ids] of childrenMap) {
				ids.sort(
					(a, b) =>
						(nodes.get(a)?.orderNum ?? 0) - (nodes.get(b)?.orderNum ?? 0),
				);
				childrenMap.set(parentId, ids);
			}
			return { ...state, nodes, childrenMap };
		}
		case "SET_CHILDREN": {
			const nextNodes = new Map(state.nodes);
			const nextChildren = new Map(state.childrenMap);
			const childIds: number[] = [];
			for (const child of action.children) {
				nextNodes.set(child.id, child);
				childIds.push(child.id);
			}
			nextChildren.set(action.parentId, childIds);
			return { ...state, nodes: nextNodes, childrenMap: nextChildren };
		}
		case "UPDATE_NODE": {
			const existing = state.nodes.get(action.update.id);
			if (!existing) return state;
			const nextNodes = new Map(state.nodes);
			nextNodes.set(action.update.id, {
				...existing,
				...(action.update.caption !== undefined && {
					caption: action.update.caption,
				}),
				...(action.update.enabled !== undefined && {
					enabled: action.update.enabled,
				}),
				...(action.update.visible !== undefined && {
					visible: action.update.visible,
				}),
				...(action.update.pageLayout !== undefined && {
					pageLayout: action.update.pageLayout,
				}),
				...(action.update.iconImage !== undefined && {
					iconImage: action.update.iconImage,
				}),
				...(action.update.parentId !== undefined && {
					parentId: action.update.parentId,
				}),
				...(action.update.orderNum !== undefined && {
					orderNum: action.update.orderNum,
				}),
			});
			return { ...state, nodes: nextNodes };
		}
		case "REMOVE_NODE": {
			const nextNodes = new Map(state.nodes);
			nextNodes.delete(action.id);
			const nextChildren = new Map(state.childrenMap);
			// Remove from parent's children list
			for (const [parentId, children] of nextChildren) {
				const idx = children.indexOf(action.id);
				if (idx !== -1) {
					nextChildren.set(
						parentId,
						children.filter((cid) => cid !== action.id),
					);
				}
			}
			// Remove this node's children entry
			nextChildren.delete(action.id);
			const nextSelected =
				state.selectedPageId === action.id ? null : state.selectedPageId;
			return {
				...state,
				nodes: nextNodes,
				childrenMap: nextChildren,
				selectedPageId: nextSelected,
			};
		}
		case "SET_LOADING_IDS":
			return { ...state, loadingIds: action.ids };

		case "SET_SEARCH_QUERY":
			return { ...state, searchQuery: action.query };
		case "SET_SEARCH_RESULTS":
			return { ...state, searchResults: action.results, searching: false };
		case "SET_SEARCHING":
			return { ...state, searching: action.searching };
		case "TOGGLE_SORT_MODE":
			return {
				...state,
				sortMode: !state.sortMode,
				multiSelectedIds: new Set(),
			};

		case "TOGGLE_MULTI_SELECT": {
			const next = new Set(state.multiSelectedIds);
			if (next.has(action.id)) next.delete(action.id);
			else next.add(action.id);
			return { ...state, multiSelectedIds: next, focusedId: action.id };
		}
		case "RANGE_SELECT": {
			const { flatIds, from, to } = action;
			const fromIdx = flatIds.indexOf(from);
			const toIdx = flatIds.indexOf(to);
			if (fromIdx === -1 || toIdx === -1) return state;
			const lo = Math.min(fromIdx, toIdx);
			const hi = Math.max(fromIdx, toIdx);
			const next = new Set(state.multiSelectedIds);
			for (let i = lo; i <= hi; i++) next.add(flatIds[i]);
			return { ...state, multiSelectedIds: next, focusedId: action.to };
		}
		case "CLEAR_MULTI_SELECT":
			return { ...state, multiSelectedIds: new Set() };
		case "SET_FOCUSED":
			return { ...state, focusedId: action.id };

		case "SET_DIRTY":
			return { ...state, editorDirty: action.dirty };
		case "SET_ANCESTORS":
			return { ...state, ancestors: action.ancestors };

		case "ON_DIALOG_CLOSE":
			return {
				...state,
				selectedPageId: null,
				editorDirty: false,
				multiSelectedIds: new Set(),
				ancestors: [],
			};

		case "CLEAR_TREE":
			return {
				...state,
				nodes: new Map(),
				childrenMap: new Map(),
				expandedIds: new Set(),
				loadingIds: new Set(),
				selectedPageId: null,
				multiSelectedIds: new Set(),
				focusedId: null,
				searchQuery: "",
				searchResults: null,
				ancestors: [],
			};

		default:
			return state;
	}
}

// ── Context ───────────────────────────────────────────────────

export type CatalogManagerMode = "normal" | "bc";

interface CatalogManagerContextValue {
	state: CatalogManagerState;
	dispatch: Dispatch<CatalogAction>;
	catalogType: CatalogManagerMode;
	canEdit: boolean;
}

const CatalogManagerContext = createContext<CatalogManagerContextValue | null>(
	null,
);

export function CatalogManagerProvider({
	children,
	catalogType = "normal",
	canEdit = false,
}: {
	children: ReactNode;
	catalogType?: CatalogManagerMode;
	canEdit?: boolean;
}) {
	const [state, dispatch] = useReducer(reducer, initialState);
	return (
		<CatalogManagerContext.Provider
			value={{ state, dispatch, catalogType, canEdit }}
		>
			{children}
		</CatalogManagerContext.Provider>
	);
}

export function useCatalogManager() {
	const ctx = useContext(CatalogManagerContext);
	if (!ctx)
		throw new Error(
			"useCatalogManager must be used within CatalogManagerProvider",
		);
	return ctx;
}

/** Append to tree API query strings when in Builder Club mode. */
export function catalogTreeQs(catalogType: CatalogManagerMode): string {
	return catalogType === "bc" ? "&catalog=bc" : "";
}
