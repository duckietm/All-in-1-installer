"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "@/components/link";
import { cn } from "@/lib/utils";

export interface AdminTab {
	href: string;
	label: string;
	/** Extra prefixes that count as active for this tab (detail routes). */
	match?: string[];
	/** Optional group id for multi-row strips (e.g. Radio primary/tools). */
	group?: string;
}

function matchLength(pathname: string, prefix: string): number {
	if (pathname === prefix) return prefix.length + 1; // prefer exact
	if (pathname.startsWith(`${prefix}/`)) return prefix.length;
	return -1;
}

function TabRow({
	tabs,
	bestIndex,
	globalOffset,
	label,
}: {
	tabs: AdminTab[];
	bestIndex: number;
	globalOffset: number;
	label?: string;
}) {
	return (
		<div className="min-w-0">
			{label ? (
				<div className="px-1 pb-1 text-[0.65rem] font-bold uppercase tracking-widest text-[var(--admin-text-muted)]">
					{label}
				</div>
			) : null}
			<nav
				className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] -mx-1 px-1"
				aria-label={label ? `Section ${label}` : "Section"}
			>
				{tabs.map((tab, index) => {
					const active = globalOffset + index === bestIndex;
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={active ? "page" : undefined}
							className={cn(
								"-mb-px shrink-0 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-semibold no-underline transition-colors",
								active
									? "border-[var(--admin-accent)] text-[var(--admin-text)] bg-[var(--admin-accent)]/8"
									: "border-transparent text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] hover:bg-[var(--admin-accent)]/5",
							)}
						>
							{tab.label}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}

export function AdminSectionTabs({ tabs }: { tabs: AdminTab[] }) {
	const pathname = usePathname() ?? "";
	const t = useTranslations("pages.admin.hubs");

	let bestIndex = -1;
	let bestScore = -1;
	tabs.forEach((tab, index) => {
		const prefixes = tab.match ?? [tab.href];
		for (const prefix of prefixes) {
			const score = matchLength(pathname, prefix);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
	});

	const hasGroups = tabs.some((t) => t.group);
	if (!hasGroups) {
		return <TabRow tabs={tabs} bestIndex={bestIndex} globalOffset={0} />;
	}

	const order: string[] = [];
	for (const tab of tabs) {
		const g = tab.group ?? "primary";
		if (!order.includes(g)) order.push(g);
	}

	let offset = 0;
	return (
		<div className="space-y-3">
			{order.map((groupId) => {
				const groupTabs = tabs.filter(
					(tab) => (tab.group ?? "primary") === groupId,
				);
				const rowOffset = offset;
				offset += groupTabs.length;
				const label = groupId === "tools" ? t("tabs.toolsGroup") : undefined;
				return (
					<TabRow
						key={groupId}
						tabs={groupTabs}
						bestIndex={bestIndex}
						globalOffset={rowOffset}
						label={label}
					/>
				);
			})}
		</div>
	);
}
