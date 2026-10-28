"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import { findAdminHub } from "@/lib/admin-nav";

/**
 * When the current path belongs to a hub, wraps children with a shared
 * title + tab strip. Dashboard and unknown routes render children as-is.
 */
export function AdminHubChrome({ children }: { children: ReactNode }) {
	const pathname = usePathname() ?? "";
	const hub = findAdminHub(pathname);
	const t = useTranslations("pages.admin.hubs");

	if (!hub) return <>{children}</>;

	const tabs = hub.tabs.map((tab) => ({
		href: tab.href,
		label: t(`tabs.${tab.labelKey}`),
		match: tab.match,
		group: tab.group,
	}));

	return (
		<AdminPageShell
			icon={hub.icon}
			title={t(hub.titleKey)}
			subtitle={t(hub.subtitleKey)}
			tabs={tabs.length > 1 ? <AdminSectionTabs tabs={tabs} /> : undefined}
			className="admin-hub-panel"
		>
			{children}
		</AdminPageShell>
	);
}
