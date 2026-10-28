"use client";

import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	FolderTree,
	Loader2,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useMemo, useState, useTransition } from "react";
import {
	refreshCatalogTree,
	useLiveCatalog,
} from "@/features/catalog/client/use-live-catalog";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/types/catalog";

/**
 * A refresh that fails must be visible. Every number and category below is
 * presented as current, so silently keeping the previous tree after a failed
 * read would show pre-import data as if nothing had happened — and a staff
 * member has no other signal that the import they just ran is not on screen.
 */
function LiveCatalogNotice() {
	const t = useTranslations("admin.studio");
	const { refreshError, refreshing } = useLiveCatalog();
	const [retrying, startRetry] = useTransition();
	if (!refreshError && !refreshing) return null;
	return (
		<p
			role="status"
			className={cn(
				"mx-3 mb-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
				refreshError
					? "border-destructive/40 bg-destructive/10 text-destructive"
					: "text-[var(--admin-text-muted)]",
			)}
		>
			{refreshError ? (
				<>
					<AlertTriangle size={14} className="shrink-0" />
					<span className="min-w-0 flex-1">{t("rail.refreshFailed")}</span>
					<button
						type="button"
						disabled={retrying}
						onClick={() =>
							startRetry(async () => {
								await refreshCatalogTree();
							})
						}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium underline disabled:opacity-50"
					>
						<RefreshCw size={12} className={cn(retrying && "animate-spin")} />
						{t("rail.retry")}
					</button>
				</>
			) : (
				<>
					<Loader2 size={14} className="shrink-0 animate-spin" />
					<span className="min-w-0 flex-1">{t("rail.updating")}</span>
				</>
			)}
		</p>
	);
}

export const CatalogRail = memo(function CatalogRail({
	tree,
	selectedId,
	onSelect,
	onClose,
}: {
	tree: TreeNode[];
	selectedId: number | null;
	onSelect: (id: number | null) => void;
	onClose?: () => void;
}) {
	const t = useTranslations("admin.studio");
	const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
	const [search, setSearch] = useState("");
	const visible = useMemo(() => {
		if (search.trim())
			return tree.filter((node) =>
				node.caption.toLowerCase().includes(search.trim().toLowerCase()),
			);
		const hidden = new Set<number>();
		for (const node of tree)
			if (hidden.has(node.parentId) || collapsed.has(node.parentId))
				hidden.add(node.id);
		return tree.filter((node) => !hidden.has(node.id));
	}, [tree, collapsed, search]);
	function toggle(id: number) {
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	return (
		<aside
			aria-label={t("aria.catalogCategories")}
			className="absolute inset-y-0 left-0 z-30 flex w-64 max-w-[85%] flex-col border-r border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl lg:static lg:z-auto lg:shrink-0 lg:shadow-none"
		>
			<div className="flex items-center gap-2 px-3 pt-3">
				<FolderTree size={16} />
				<h2
					style={{ fontSize: 14, margin: 0 }}
					className="flex-1 text-sm font-semibold"
				>
					{t("rail.title")}
				</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label={t("aria.closeCategories")}
					className="grid h-9 w-9 place-items-center rounded-md hover:bg-[var(--admin-accent)]/10"
				>
					<X size={16} />
				</button>
			</div>
			<label className="mx-3 my-3 flex items-center gap-2 rounded-md border border-[var(--admin-border)] px-2">
				<Search size={14} />
				<input
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder={t("aria.findCategory")}
					aria-label={t("aria.findCategory")}
					className="h-9 min-w-0 w-full border-0 bg-transparent text-sm outline-none"
				/>
			</label>
			<button
				type="button"
				onClick={() => onSelect(null)}
				aria-pressed={selectedId === null}
				className="mx-2 mb-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--admin-accent)]/10 aria-pressed:bg-[var(--admin-accent)]/15"
			>
				{t("rail.all")}
			</button>
			<LiveCatalogNotice />
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
				{visible.length === 0 && (
					<p className="p-3 text-sm text-[var(--admin-text-muted)]">
						{t("rail.noMatches")}
					</p>
				)}
				{visible.map((node) => (
					<div
						key={node.id}
						className={cn(
							"flex items-center rounded-md",
							selectedId === node.id && "bg-[var(--admin-accent)]/15",
						)}
						style={{
							paddingLeft: search.trim() ? 0 : Math.min(node.depth * 12, 60),
						}}
					>
						{node.childCount > 0 && !search.trim() ? (
							<button
								type="button"
								aria-label={
									collapsed.has(node.id)
										? t("aria.expandCategory", { name: node.caption })
										: t("aria.collapseCategory", { name: node.caption })
								}
								aria-expanded={!collapsed.has(node.id)}
								onClick={() => toggle(node.id)}
								className="grid h-10 w-8 shrink-0 place-items-center rounded-md hover:bg-[var(--admin-accent)]/10"
							>
								{collapsed.has(node.id) ? (
									<ChevronRight size={14} />
								) : (
									<ChevronDown size={14} />
								)}
							</button>
						) : (
							<span className="w-8 shrink-0" />
						)}
						<button
							type="button"
							onClick={() => onSelect(node.id)}
							aria-pressed={selectedId === node.id}
							title={node.caption}
							className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-2 text-left text-sm hover:bg-[var(--admin-accent)]/10"
						>
							<span className="min-w-0 flex-1 truncate">{node.caption}</span>
							<span className="text-xs tabular-nums text-[var(--admin-text-muted)]">
								{node.itemCount}
							</span>
						</button>
					</div>
				))}
			</div>
		</aside>
	);
});
