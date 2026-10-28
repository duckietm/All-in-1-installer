import { eq } from "drizzle-orm";
import { LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AdminHubChrome } from "@/components/admin/admin-hub-chrome";
import { AdminMobileWrapper } from "@/components/admin/admin-mobile-wrapper";
import { AdminSidebarNav } from "@/components/admin/admin-sidebar-nav";
import { AdminToaster } from "@/components/admin/admin-toaster";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "@/components/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { requireStaff } from "@/lib/admin/guard";
import { loadAdminNavigation } from "@/lib/admin/navigation";
import { db, User } from "@/lib/db";
import { readCsrfCookieToken } from "@/lib/foundation/security";
import { siteSettings } from "@/lib/services/site-settings";

// Request-time auth, existing CSRF cookie, and optional 2FA gate cannot be
// statically rendered. The root layout's Cache Components opt-out
// (instant = false) covers this route tree — leaf opt-outs are redundant.

export default async function AdminLayout({
	children,
}: {
	children: ReactNode;
}) {
	const staff = await requireStaff();
	const navigation = await loadAdminNavigation();
	const csrfToken = await readCsrfCookieToken();
	if (await siteSettings.getBool("force_staff_2fa", false)) {
		const u = await db
			.select({ twoFactorConfirmedAt: User.twoFactorConfirmedAt })
			.from(User)
			.where(eq(User.id, staff.id))
			.limit(1)
			.then((rows) => rows[0] ?? null)
			.catch(() => null);
		if (!u?.twoFactorConfirmedAt) redirect("/settings/2fa?error=staffrequired");
	}

	// The root layout ships the reduced catalogue so public pages do not carry
	// the ~195 KB of staff-tool strings. Nested providers replace the parent
	// set rather than merging, so staff route groups re-install the full one.
	const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

	return (
		<NextIntlClientProvider locale={locale} messages={messages}>
			{csrfToken ? <meta name="csrf-token" content={csrfToken} /> : null}
			<AdminMobileWrapper sidebar={<Sidebar staff={staff} />}>
				<div
					data-admin
					className="flex flex-col min-w-0 p-5 lg:p-6 min-h-full"
					style={{ backgroundColor: "var(--admin-canvas)" }}
				>
					<AdminTopbar staff={staff} navigation={navigation} />
					<section className="admin-page flex-1">
						<AdminHubChrome>{children}</AdminHubChrome>
					</section>
				</div>
			</AdminMobileWrapper>
			<AdminToaster />
		</NextIntlClientProvider>
	);
}

async function Sidebar({
	staff,
}: {
	staff: { id: number; username: string; rank: number };
}) {
	const t = await getTranslations("pages.admin.nav");
	const initial = staff.username.charAt(0).toUpperCase();
	const { allowedPermissions, isSuperAdmin, navConfig } =
		await loadAdminNavigation();

	return (
		<aside
			data-admin
			className="max-lg:static sticky top-0 flex h-full max-h-screen min-h-0 w-full flex-col self-start overflow-hidden bg-[var(--admin-sidebar-background)] text-[var(--admin-sidebar-text-readable)] shadow-xl lg:h-screen"
		>
			<div className="flex shrink-0 items-center gap-3 border-b border-[var(--admin-border)] px-4 py-5">
				<span
					className="flex-none w-10 h-10 rounded-xl grid place-items-center font-extrabold text-base text-[var(--admin-accent-foreground)] bg-[var(--admin-accent)] shadow-lg shadow-[var(--admin-accent)]/20"
					aria-hidden
				>
					{initial}
				</span>
				<div className="min-w-0 flex-1">
					<div className="font-semibold text-sm text-[var(--admin-sidebar-text-readable)] truncate">
						{staff.username}
					</div>
					<span className="inline-block mt-0.5 text-[0.6rem] font-bold uppercase tracking-widest text-[var(--admin-sidebar-muted-readable)]">
						{t("rankLabel", { rank: staff.rank })}
					</span>
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					<LanguageSwitcher variant="admin" />
					<ThemeSwitcher variant="admin" />
				</div>
			</div>

			<AdminSidebarNav
				allowedPermissions={allowedPermissions}
				isSuperAdmin={isSuperAdmin}
				navConfig={navConfig}
			/>

			<div className="shrink-0 border-t border-[var(--admin-border)] px-3 py-3">
				<Link
					href="/"
					className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[var(--admin-sidebar-muted-readable)] text-xs font-medium hover:text-[var(--admin-sidebar-text-readable)] hover:bg-[var(--admin-accent)]/10 transition-all duration-150 no-underline"
				>
					<LogOut size={14} />
					<span>{t("backToSite")}</span>
				</Link>
			</div>
		</aside>
	);
}
