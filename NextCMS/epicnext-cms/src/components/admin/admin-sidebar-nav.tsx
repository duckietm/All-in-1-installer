"use client";

import {
	ChevronDown,
	ChevronsDownUp,
	ChevronsUpDown,
	Search,
	X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import type { AdminNavItem } from "@/lib/admin-nav";
import type { AdminNavConfig } from "@/lib/admin-nav-config";
import { visibleAdminNavigation } from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "admin-nav-collapsed";

function itemIsActive(pathname: string, item: AdminNavItem): boolean {
	if (
		item.matchExcludePrefixes?.some(
			(p) => pathname === p || pathname.startsWith(`${p}/`),
		)
	) {
		return false;
	}
	if (item.href === "/admin") return pathname === "/admin";
	if (item.matchPrefixes?.length) {
		return item.matchPrefixes.some(
			(p) => pathname === p || pathname.startsWith(`${p}/`),
		);
	}
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function groupHasActive(pathname: string, items: AdminNavItem[]): boolean {
	return items.some((item) => itemIsActive(pathname, item));
}

function readCollapsed(): Record<string, boolean> {
	if (typeof window === "undefined") return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		return parsed as Record<string, boolean>;
	} catch {
		return {};
	}
}

function persistCollapsed(next: Record<string, boolean>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* ignore quota */
	}
}

export function AdminSidebarNav({
	allowedPermissions = [],
	isSuperAdmin = false,
	navConfig = {},
}: {
	/** ACL slugs the staff member holds (ignored when isSuperAdmin). */
	allowedPermissions?: string[];
	isSuperAdmin?: boolean;
	/** Owner overlay: hide + reorder groups/items (from website_settings). */
	navConfig?: AdminNavConfig;
}) {
	const t = useTranslations("pages.admin.nav");
	const pathname = usePathname() ?? "";
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [hydrated, setHydrated] = useState(false);
	const [query, setQuery] = useState("");

	const groups = useMemo(
		() =>
			visibleAdminNavigation({ allowedPermissions, isSuperAdmin, navConfig }),
		[allowedPermissions, isSuperAdmin, navConfig],
	);

	const search = query.trim().toLocaleLowerCase();
	const visibleGroups = useMemo(
		() =>
			groups
				.map((group) => ({
					...group,
					items: group.items.filter(
						(item) =>
							!search ||
							t(group.labelKey).toLocaleLowerCase().includes(search) ||
							t(item.labelKey).toLocaleLowerCase().includes(search),
					),
				}))
				.filter((group) => group.items.length > 0),
		[groups, search, t],
	);

	const allKeys = useMemo(() => groups.map((g) => g.labelKey), [groups]);

	useEffect(() => {
		const saved = readCollapsed();
		setCollapsed(
			Object.fromEntries(
				groups.map((group) => [
					group.labelKey,
					typeof saved[group.labelKey] === "boolean"
						? saved[group.labelKey]
						: true,
				]),
			),
		);
		setHydrated(true);
	}, [groups]);

	// Keep the group that contains the current page open.
	useEffect(() => {
		if (!hydrated) return;
		const activeKeys = groups
			.filter((g) => groupHasActive(pathname, g.items))
			.map((g) => g.labelKey);
		if (activeKeys.length === 0) return;
		setCollapsed((prev) => {
			let changed = false;
			const next = { ...prev };
			for (const key of activeKeys) {
				if (next[key]) {
					next[key] = false;
					changed = true;
				}
			}
			if (!changed) return prev;
			persistCollapsed(next);
			return next;
		});
	}, [pathname, hydrated, groups]);

	const toggle = useCallback((labelKey: string) => {
		setCollapsed((prev) => {
			const next = { ...prev, [labelKey]: !prev[labelKey] };
			persistCollapsed(next);
			return next;
		});
	}, []);

	const expandAll = useCallback(() => {
		const next: Record<string, boolean> = {};
		for (const key of allKeys) next[key] = false;
		persistCollapsed(next);
		setCollapsed(next);
	}, [allKeys]);

	const collapseAll = useCallback(() => {
		const next: Record<string, boolean> = {};
		for (const key of allKeys) next[key] = true;
		// Keep the active route's group open so you never lose context.
		for (const g of groups) {
			if (groupHasActive(pathname, g.items)) next[g.labelKey] = false;
		}
		persistCollapsed(next);
		setCollapsed(next);
	}, [allKeys, groups, pathname]);

	const allExpanded = hydrated && allKeys.every((k) => !collapsed[k]);
	const canCollapseMore =
		hydrated &&
		allKeys.some((k) => {
			const g = groups.find((x) => x.labelKey === k);
			if (g && groupHasActive(pathname, g.items)) return false;
			return !collapsed[k];
		});

	return (
		<nav
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
			aria-label={t("overview")}
		>
			<div className="shrink-0 px-3 pt-3">
				<div className="relative">
					<Search
						size={16}
						aria-hidden
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-sidebar-muted-readable)]"
					/>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape" && query) {
								event.stopPropagation();
								setQuery("");
							}
						}}
						aria-label={t("searchMenu")}
						placeholder={t("searchMenu")}
						style={{
							paddingLeft: 36,
							paddingRight: 36,
							backgroundColor: "var(--admin-sidebar-background)",
							color: "var(--admin-sidebar-text-readable)",
						}}
						className="h-10 w-full min-w-0 rounded-lg border border-[var(--admin-border)] text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							aria-label={t("clearMenuSearch")}
							className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[var(--admin-sidebar-text-readable)] focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
						>
							<X size={14} />
						</button>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1 border-b border-[var(--admin-border)] px-3 py-2">
				<button
					type="button"
					onClick={expandAll}
					disabled={allExpanded || !!search}
					title={t("expandAll")}
					aria-label={t("expandAll")}
					className={cn(
						"inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5",
						"text-[0.65rem] font-bold uppercase tracking-wide",
						"text-[var(--admin-sidebar-muted-readable)]",
						"hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-sidebar-text-readable)]",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]",
						"disabled:pointer-events-none disabled:opacity-40",
						"transition-colors",
					)}
				>
					<ChevronsUpDown size={14} aria-hidden />
					<span className="truncate">{t("expandAll")}</span>
				</button>
				<button
					type="button"
					onClick={collapseAll}
					disabled={!canCollapseMore || !!search}
					title={t("collapseAll")}
					aria-label={t("collapseAll")}
					className={cn(
						"inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5",
						"text-[0.65rem] font-bold uppercase tracking-wide",
						"text-[var(--admin-sidebar-muted-readable)]",
						"hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-sidebar-text-readable)]",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]",
						"disabled:pointer-events-none disabled:opacity-40",
						"transition-colors",
					)}
				>
					<ChevronsDownUp size={14} aria-hidden />
					<span className="truncate">{t("collapseAll")}</span>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
				{visibleGroups.length === 0 && (
					<p
						role="status"
						className="px-2 py-6 text-sm text-[var(--admin-sidebar-muted-readable)]"
					>
						{t("noMenuResults")}
					</p>
				)}
				{visibleGroups.map((group, gi) => {
					const GroupIcon = group.icon;
					const isCollapsed = !search && Boolean(collapsed[group.labelKey]);
					const panelId = `admin-nav-${group.labelKey}`;

					return (
						<div
							key={group.labelKey}
							className={
								gi > 0 ? "mt-3 border-t border-[var(--admin-border)] pt-3" : ""
							}
						>
							<button
								type="button"
								onClick={() => toggle(group.labelKey)}
								disabled={!!search}
								aria-expanded={!isCollapsed}
								aria-controls={panelId}
								className={cn(
									"flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left",
									"text-xs font-semibold",
									"text-[var(--admin-sidebar-muted-readable)]",
									"hover:opacity-100 hover:bg-[var(--admin-accent)]/10",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]",
									"transition-colors",
								)}
							>
								<GroupIcon size={14} className="shrink-0" />
								<span className="min-w-0 flex-1 truncate">
									{t(group.labelKey)}
								</span>
								<span
									aria-hidden
									className="text-xs tabular-nums text-[var(--admin-sidebar-muted-readable)]"
								>
									{group.items.length}
								</span>
								<ChevronDown
									size={14}
									className={cn(
										"shrink-0 opacity-80 transition-transform duration-200",
										isCollapsed && "-rotate-90",
									)}
									aria-hidden
								/>
							</button>
							<div
								id={panelId}
								hidden={isCollapsed}
								className="mt-1 space-y-0.5"
							>
								{group.items.map((item) => {
									const ItemIcon = item.icon;
									return (
										<AdminNavLink
											key={`${group.labelKey}-${item.href}`}
											href={item.href}
											matchPrefixes={item.matchPrefixes}
											matchExcludePrefixes={item.matchExcludePrefixes}
											icon={<ItemIcon size={16} />}
										>
											{t(item.labelKey)}
										</AdminNavLink>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</nav>
	);
}
