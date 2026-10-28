export interface TreeNode {
	id: number;
	caption: string;
	parentId: number;
	depth: number;
	orderNum: number;
	enabled: string;
	visible: string;
	iconImage: number;
	iconColor: number;
	pageLayout: string;
	childCount: number;
	itemCount: number;
}

export interface NestedTreeNode extends TreeNode {
	children: NestedTreeNode[];
}

export interface TreeNodeData {
	id: number;
	caption: string;
	parentId: number;
	depth?: number;
	orderNum?: number;
	enabled: string;
	visible: string;
	iconImage: number;
	iconColor: number;
	pageLayout: string;
	childCount: number;
	itemCount: number;
}

export interface TreeNodeUpdate {
	id: number;
	caption?: string;
	enabled?: string;
	visible?: string;
	pageLayout?: string;
	iconImage?: number;
	parentId?: number;
	orderNum?: number;
}

export interface RootTab {
	id: number;
	caption: string;
	iconImage: number;
	enabled: string;
	orderNum: number;
}
