"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchDialog } from "@/components/admin/search-dialog";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { findAdminHub } from "@/lib/admin-nav";
import type { AdminNavigationOptions } from "@/lib/admin-navigation";

export function AdminTopbar({
	staff,
	navigation,
}: {
	staff: { id: number; username: string; rank: number };
	navigation: AdminNavigationOptions;
}) {
	const tNav = useTranslations("pages.admin.nav");
	const tHubs = useTranslations("pages.admin.hubs");
	const pathname = usePathname() ?? "";
	const hub = findAdminHub(pathname);
	const title = hub ? tHubs(hub.titleKey) : tNav("housekeeping");

	return (
		<header className="flex items-center justify-between flex-wrap gap-3 bg-[var(--admin-surface)] border border-[var(--admin-border)] rounded-2xl px-5 py-3 mb-5 shadow-card">
			<div className="flex items-center gap-3">
				<h2 className="m-0 text-base font-extrabold text-[var(--admin-text)]">
					{title}
				</h2>
				<span className="hidden sm:inline-block w-px h-5 bg-[var(--admin-border)]" />
				<span className="hidden sm:inline text-xs text-[var(--admin-text-muted)]">
					{tNav("hotelManagementPanel")}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<SearchDialog navigation={navigation} />
				<div className="flex items-center gap-1.5 lg:hidden">
					<LanguageSwitcher variant="admin" />
					<ThemeSwitcher variant="admin" />
				</div>
				<span className="text-xs text-[var(--admin-text-muted)]">
					<strong className="text-[var(--admin-text)]">{staff.username}</strong>
				</span>
				<span className="inline-flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-wider text-[var(--admin-accent-foreground)] bg-[var(--admin-accent)] rounded-full px-2.5 py-1">
					{tNav("rankLabel", { rank: staff.rank })}
				</span>
			</div>
		</header>
	);
}
