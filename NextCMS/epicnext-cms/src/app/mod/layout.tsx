import { eq } from "drizzle-orm";
import {
	Ban,
	Gavel,
	LogOut,
	Radio,
	Shield,
	Ticket,
	UserRound,
	Users,
} from "lucide-react";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "@/components/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { requireMod } from "@/lib/admin/guard";
import { db, User } from "@/lib/db";
import { readCsrfCookieToken } from "@/lib/foundation/security";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

export default async function ModLayout({ children }: { children: ReactNode }) {
	const staff = await requireMod();
	const csrfToken = await readCsrfCookieToken();
	if (await siteSettings.getBool("force_staff_2fa", false)) {
		const [u] = await db
			.select({ twoFactorConfirmedAt: User.twoFactorConfirmedAt })
			.from(User)
			.where(eq(User.id, staff.id))
			.limit(1)
			.catch(() => [] as { twoFactorConfirmedAt: Date | null }[]);
		if (!u?.twoFactorConfirmedAt) redirect("/settings/2fa?error=staffrequired");
	}

	const t = await getTranslations("pages.mod");
	const { permissions } = await getAdminContext();
	const showCfh =
		canAccess(permissions, PERMS.MOD_CFH_VIEW, staff.rank) ||
		canAccess(permissions, PERMS.MODERATION_VIEW, staff.rank);
	const showActions =
		canAccess(permissions, PERMS.MOD_ACTIONS, staff.rank) ||
		canAccess(permissions, PERMS.MODERATION_EDIT, staff.rank);
	const showBans =
		canAccess(permissions, PERMS.MOD_BANS_VIEW, staff.rank) ||
		canAccess(permissions, PERMS.BANS_VIEW, staff.rank);
	const showTickets =
		canAccess(permissions, PERMS.MOD_TICKETS_VIEW, staff.rank) ||
		canAccess(permissions, PERMS.TICKETS_VIEW, staff.rank);
	const showTeam =
		canAccess(permissions, PERMS.MOD_TEAM_VIEW, staff.rank) ||
		canAccess(permissions, PERMS.MODERATION_VIEW, staff.rank);
	const showUsers =
		canAccess(permissions, PERMS.MOD_USERS_VIEW, staff.rank) ||
		canAccess(permissions, PERMS.USERS_VIEW, staff.rank);
	const showAdmin = canAccess(permissions, PERMS.ADMIN_DASHBOARD, staff.rank);

	const nav = [
		{ href: "/mod", label: t("nav.overview"), icon: Shield, show: true },
		{ href: "/mod/cfh", label: t("nav.cfh"), icon: Radio, show: showCfh },
		{
			href: "/mod/tickets",
			label: t("nav.tickets"),
			icon: Ticket,
			show: showTickets,
		},
		{
			href: "/mod/actions",
			label: t("nav.actions"),
			icon: Gavel,
			show: showActions,
		},
		{ href: "/mod/bans", label: t("nav.bans"), icon: Ban, show: showBans },
		{
			href: "/mod/users",
			label: t("nav.users"),
			icon: UserRound,
			show: showUsers,
		},
		{ href: "/mod/team", label: t("nav.team"), icon: Users, show: showTeam },
	].filter((item) => item.show);

	// The root layout ships the reduced catalogue so public pages do not carry
	// the ~195 KB of staff-tool strings. Nested providers replace the parent
	// set rather than merging, so staff route groups re-install the full one.
	const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

	return (
		<NextIntlClientProvider locale={locale} messages={messages}>
			{csrfToken ? <meta name="csrf-token" content={csrfToken} /> : null}
			<div
				data-admin
				className="min-h-screen"
				style={{ backgroundColor: "var(--admin-canvas)" }}
			>
				<header className="border-b border-[var(--admin-border)] bg-[var(--admin-sidebar-background)]">
					<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
						<div className="min-w-0 flex-1">
							<p className="m-0 text-xs font-bold uppercase tracking-widest text-[var(--admin-sidebar-muted-readable)]">
								{t("badge")}
							</p>
							<h1 className="m-0 truncate text-lg font-semibold text-[var(--admin-sidebar-text-readable)]">
								{t("title")}
							</h1>
							<p className="m-0 text-xs text-[var(--admin-sidebar-muted-readable)]">
								{staff.username} · rank {staff.rank}
							</p>
						</div>
						<div className="flex items-center gap-1.5">
							<LanguageSwitcher variant="admin" />
							<ThemeSwitcher variant="admin" />
							{showAdmin ? (
								<Link
									href="/admin"
									className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--admin-sidebar-muted-readable)] no-underline hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-sidebar-text-readable)]"
								>
									{t("nav.fullAdmin")}
								</Link>
							) : null}
							<Link
								href="/"
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--admin-sidebar-muted-readable)] no-underline hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-sidebar-text-readable)]"
							>
								<LogOut size={14} />
								{t("nav.backToSite")}
							</Link>
						</div>
					</div>
					<nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3">
						{nav.map((item) => {
							const Icon = item.icon;
							return (
								<Link
									key={item.href}
									href={item.href}
									className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--admin-sidebar-muted-readable)] no-underline hover:bg-[var(--admin-accent)]/10 hover:text-[var(--admin-sidebar-text-readable)]"
								>
									<Icon size={14} />
									{item.label}
								</Link>
							);
						})}
					</nav>
				</header>
				<main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
			</div>
		</NextIntlClientProvider>
	);
}
