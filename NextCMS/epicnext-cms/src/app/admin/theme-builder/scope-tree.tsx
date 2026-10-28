"use client";

import Link from "next/link";

interface ScopeNode {
	id: number;
	name: string;
	type: string;
	parentId: number | null;
	siteDomain: string | null;
	routePath: string | null;
	moduleId: string | null;
	isActive: boolean;
	children: ScopeNode[];
}

interface ScopeTreeProps {
	tree: ScopeNode[];
	selectedId: number | null;
}

const TYPE_ICONS: Record<string, string> = {
	global: "🌍",
	site: "🌐",
	module: "📦",
	route: "📄",
};

function TreeNode({
	node,
	selectedId,
	depth = 0,
}: {
	node: ScopeNode;
	selectedId: number | null;
	depth?: number;
}) {
	const isSelected = node.id === selectedId;

	return (
		<div>
			<Link
				href={`/admin/theme-builder?scope=${node.id}`}
				className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
					isSelected
						? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] font-medium"
						: "text-[var(--admin-text)] hover:bg-[var(--admin-surface-elevated)]"
				}`}
				style={{ paddingLeft: `${depth * 16 + 12}px` }}
			>
				<span className="text-base leading-none">
					{TYPE_ICONS[node.type] ?? "•"}
				</span>
				<span className="truncate flex-1">{node.name}</span>
				{!node.isActive ? (
					<span className="text-[10px] text-[var(--admin-text-muted)] opacity-60">
						OFF
					</span>
				) : null}
			</Link>
			{node.children.length > 0 ? (
				<div>
					{node.children.map((child) => (
						<TreeNode
							key={child.id}
							node={child}
							selectedId={selectedId}
							depth={depth + 1}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

export function ScopeTree({ tree, selectedId }: ScopeTreeProps) {
	return (
		<div className="admin-card p-3">
			<h3 className="text-xs font-semibold text-[var(--admin-text-muted)] uppercase tracking-wider px-3 mb-2">
				Theme Scopes
			</h3>
			<div className="space-y-0.5">
				{tree.length === 0 ? (
					<p className="text-xs text-[var(--admin-text-muted)] px-3 py-4">
						No scopes created yet. Add one below.
					</p>
				) : (
					tree.map((node) => (
						<TreeNode key={node.id} node={node} selectedId={selectedId} />
					))
				)}
			</div>
			<div className="mt-3 px-3 pt-3 border-t border-[var(--admin-border)]">
				<div className="flex flex-wrap gap-2 text-[10px] text-[var(--admin-text-muted)]">
					{Object.entries(TYPE_ICONS).map(([type, icon]) => (
						<span key={type} className="flex items-center gap-1">
							{icon} {type}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}
