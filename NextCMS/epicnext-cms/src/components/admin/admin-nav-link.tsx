"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAdminMobile } from "@/components/admin/admin-mobile-wrapper";
import Link from "@/components/link";

/**
 * Sidebar link that highlights when its route is active.
 * Optional matchPrefixes cover multi-page hubs (e.g. Settings → theme/vpn).
 */
export function AdminNavLink({
	href,
	icon,
	matchPrefixes,
	matchExcludePrefixes,
	children,
}: {
	href: string;
	icon?: ReactNode;
	matchPrefixes?: string[];
	matchExcludePrefixes?: string[];
	children: ReactNode;
}) {
	const pathname = usePathname() ?? "";
	const { close } = useAdminMobile();

	const excluded = matchExcludePrefixes?.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);

	let active: boolean;
	if (excluded) {
		active = false;
	} else if (href === "/admin") {
		active = pathname === "/admin";
	} else if (matchPrefixes?.length) {
		active = matchPrefixes.some(
			(p) => pathname === p || pathname.startsWith(`${p}/`),
		);
	} else {
		active = pathname === href || pathname.startsWith(`${href}/`);
	}

	return (
		<Link
			href={href}
			onClick={close}
			style={{ color: "var(--admin-sidebar-text-readable)" }}
			aria-current={active ? "page" : undefined}
			className={`group flex min-h-10 items-center gap-2.5 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm no-underline transition-colors duration-150
				focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--admin-sidebar-background)] ${
					active
						? "bg-[var(--admin-accent)]/25 font-semibold text-[var(--admin-sidebar-text-readable)] border-l-[var(--admin-accent)] shadow-sm"
						: "font-medium text-[var(--admin-sidebar-text-readable)] hover:bg-[var(--admin-accent)]/10 hover:no-underline"
				}`}
		>
			{icon ? (
				<span
					className={`flex-none transition-colors ${
						active
							? "text-[var(--admin-accent)]"
							: "text-[var(--admin-sidebar-text-readable)] opacity-75 group-hover:opacity-100"
					}`}
				>
					{icon}
				</span>
			) : null}
			<span className="min-w-0 flex-1 break-words leading-5">{children}</span>
		</Link>
	);
}
