import { count, eq } from "drizzle-orm";
import Image from "next/image";
import type { Session } from "next-auth";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "@/components/link";
import { MobileNav } from "@/components/mobile-nav";
import { NavDropdown } from "@/components/nav-dropdown";
import { NavbarColorPicker } from "@/components/navbar-color-picker";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { db, MessengerFriendrequests, MessengerOffline } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { canAccess, getApiAdminContext, PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import {
	ICON_NAV_BB,
	ICON_NAV_COMMUNITY,
	ICON_NAV_GOODY,
	ICON_NAV_LEADERBOARDS,
	ICON_NAV_ME,
	ICON_NAV_RULES,
	ICON_NAV_SHOP,
} from "@/lib/site-icons";

export async function Navigation({ session }: { session: Session | null }) {
	const t = await getTranslations("nav");
	const headerT = await getTranslations("header");
	const brandLabel = await resolveHotelName();
	let showAdmin = false;
	let showMod = false;
	if (session?.user) {
		const ctx = await getApiAdminContext();
		if (ctx) {
			showAdmin = canAccess(
				ctx.permissions,
				PERMS.ADMIN_DASHBOARD,
				ctx.session.user.rank,
			);
			showMod =
				canAccess(
					ctx.permissions,
					PERMS.MOD_DASHBOARD,
					ctx.session.user.rank,
				) ||
				canAccess(
					ctx.permissions,
					PERMS.MODERATION_VIEW,
					ctx.session.user.rank,
				) ||
				canAccess(ctx.permissions, PERMS.MOD_CFH_VIEW, ctx.session.user.rank) ||
				canAccess(ctx.permissions, PERMS.MOD_ACTIONS, ctx.session.user.rank);
		}
	}

	let unreadMessages = 0;
	let pendingFriendRequests = 0;
	if (session?.user?.id) {
		const id = Number(session.user.id);
		try {
			const [unreadRows, pendingRows] = await Promise.all([
				db
					.select({ total: count() })
					.from(MessengerOffline)
					.where(eq(MessengerOffline.userId, id)),
				db
					.select({ total: count() })
					.from(MessengerFriendrequests)
					.where(eq(MessengerFriendrequests.userToId, id)),
			]);
			unreadMessages = unreadRows[0]?.total ?? 0;
			pendingFriendRequests = pendingRows[0]?.total ?? 0;
		} catch (error) {
			logServerError("navigation.messenger_counts_failed", error, {
				userId: id,
			});
		}
	}

	return (
		<nav
			className="sticky top-0 z-40"
			style={{ backgroundColor: "var(--color-navbar)" }}
		>
			<div className="relative mx-auto flex min-h-[56px] max-w-7xl items-center px-4 md:px-6 gap-x-2">
				<div
					className="absolute bottom-0 left-0 right-0 h-[3px]"
					style={{ backgroundColor: "var(--color-primary, #eeb425)" }}
				/>

				{/* Desktop: home link */}
				<div className="hidden md:flex items-center gap-x-1">
					<Link href="/" className="nav-item shrink-0">
						<Image
							src={ICON_NAV_ME}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						<span>{t("home")}</span>
					</Link>
				</div>

				{/* Desktop: nav items */}
				<div className="hidden md:flex items-center gap-x-1">
					<NavDropdown label={t("community")} icon={ICON_NAV_COMMUNITY}>
						<Link href="/news" className="dropdown-item" role="menuitem">
							{t("articles")}
						</Link>
						<Link href="/photos" className="dropdown-item" role="menuitem">
							{t("photos")}
						</Link>
						<Link href="/staff" className="dropdown-item" role="menuitem">
							{t("staff")}
						</Link>
						<Link href="/rankings" className="dropdown-item" role="menuitem">
							{t("rankings")}
						</Link>
						<Link href="/guilds" className="dropdown-item" role="menuitem">
							{t("guilds")}
						</Link>
						<Link href="/events" className="dropdown-item" role="menuitem">
							{t("events")}
						</Link>
						<Link href="/polls" className="dropdown-item" role="menuitem">
							{t("polls")}
						</Link>
					</NavDropdown>

					<NavDropdown label={t("shop")} icon={ICON_NAV_SHOP}>
						<Link href="/shop" className="dropdown-item" role="menuitem">
							{t("shop")}
						</Link>
						<Link href="/marketplace" className="dropdown-item" role="menuitem">
							{t("market")}
						</Link>
						<Link href="/rares" className="dropdown-item" role="menuitem">
							{t("rareValues")}
						</Link>
					</NavDropdown>

					<Link href="/leaderboard" className="nav-item">
						<Image
							src={ICON_NAV_LEADERBOARDS}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						{t("leaderboards")}
					</Link>

					<Link href="/radio" className="nav-item">
						<Image
							src={ICON_NAV_BB}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						{t("radio")}
					</Link>

					<NavDropdown label={t("assistance")} icon={ICON_NAV_RULES}>
						<Link href="/help" className="dropdown-item" role="menuitem">
							{t("helpCenter")}
						</Link>
						{session?.user ? (
							<Link
								href="/help/tickets"
								className="dropdown-item"
								role="menuitem"
							>
								{t("myTickets")}
							</Link>
						) : null}
						<Link href="/badges" className="dropdown-item" role="menuitem">
							{t("badges")}
						</Link>
						<Link href="/draw-badge" className="dropdown-item" role="menuitem">
							{t("drawBadge")}
						</Link>
					</NavDropdown>

					{session?.user ? (
						<>
							<Link href="/friends" className="nav-item relative">
								<Image
									src={ICON_NAV_GOODY}
									alt=""
									width={20}
									height={20}
									className="mr-1.5"
								/>
								<span>{t("friends")}</span>
							</Link>
							<Link href="/messages" className="nav-item relative">
								<Image
									src={ICON_NAV_BB}
									alt=""
									width={20}
									height={20}
									className="mr-1.5"
								/>
								<span>{t("messages")}</span>
								{unreadMessages + pendingFriendRequests > 0 && (
									<span
										className="absolute -top-1.5 -right-1.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
										style={{
											background: "var(--color-danger)",
											color: "white",
										}}
									>
										{unreadMessages + pendingFriendRequests > 9
											? "9+"
											: unreadMessages + pendingFriendRequests}
									</span>
								)}
							</Link>
						</>
					) : null}

					{showMod ? (
						<Link href="/mod" className="nav-item">
							<Image
								src="/assets/images/icons/navigation/home.png"
								alt=""
								width={20}
								height={20}
								className="mr-1.5"
							/>
							{t("mod")}
						</Link>
					) : null}

					{showAdmin ? (
						<Link href="/admin" className="nav-item">
							<Image
								src="/assets/images/icons/navigation/home.png"
								alt=""
								width={20}
								height={20}
								className="mr-1.5"
							/>
							{t("admin")}
						</Link>
					) : null}
				</div>

				{/* Desktop: search + controls */}
				<div className="ml-auto hidden md:flex items-center gap-x-2">
					{session?.user ? (
						<form
							action="/search"
							method="GET"
							className="flex items-center gap-1"
						>
							<input
								type="text"
								name="q"
								placeholder={headerT("searchUsers")}
								className="w-32 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all focus:w-40"
								style={{
									background: "var(--color-background)",
									color: "var(--color-text-readable)",
									borderColor:
										"color-mix(in srgb, var(--color-text-muted) 25%, transparent)",
								}}
							/>
							<button
								type="submit"
								className="rounded-lg px-2 py-1.5 text-xs font-bold transition-colors"
								style={{
									background:
										"color-mix(in srgb, var(--color-primary) 20%, transparent)",
									color: "var(--color-primary-readable, var(--color-primary))",
								}}
							>
								Search
							</button>
						</form>
					) : null}
					<LanguageSwitcher />
					<NavbarColorPicker />
					<ThemeSwitcher />
				</div>

				{/* Mobile: hamburger menu (details/summary) */}
				<MobileNav
					menuLabel={t("openMenu") || "Open menu"}
					closeLabel={t("closeMenu") || "Close menu"}
					brandLabel={brandLabel}
				>
					<Link href="/" className="nav-item">
						<Image
							src={ICON_NAV_ME}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						{t("home")}
					</Link>

					<NavDropdown label={t("community")} icon={ICON_NAV_COMMUNITY}>
						<Link href="/news" className="dropdown-item" role="menuitem">
							{t("articles")}
						</Link>
						<Link href="/photos" className="dropdown-item" role="menuitem">
							{t("photos")}
						</Link>
						<Link href="/staff" className="dropdown-item" role="menuitem">
							{t("staff")}
						</Link>
						<Link href="/rankings" className="dropdown-item" role="menuitem">
							{t("rankings")}
						</Link>
						<Link href="/guilds" className="dropdown-item" role="menuitem">
							{t("guilds")}
						</Link>
						<Link href="/events" className="dropdown-item" role="menuitem">
							{t("events")}
						</Link>
						<Link href="/polls" className="dropdown-item" role="menuitem">
							{t("polls")}
						</Link>
					</NavDropdown>

					<NavDropdown label={t("shop")} icon={ICON_NAV_SHOP}>
						<Link href="/shop" className="dropdown-item" role="menuitem">
							{t("shop")}
						</Link>
						<Link href="/marketplace" className="dropdown-item" role="menuitem">
							{t("market")}
						</Link>
						<Link href="/rares" className="dropdown-item" role="menuitem">
							{t("rareValues")}
						</Link>
					</NavDropdown>

					<Link href="/leaderboard" className="nav-item">
						<Image
							src={ICON_NAV_LEADERBOARDS}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						{t("leaderboards")}
					</Link>

					<Link href="/radio" className="nav-item">
						<Image
							src={ICON_NAV_BB}
							alt=""
							width={20}
							height={20}
							className="mr-1.5"
						/>
						{t("radio")}
					</Link>

					<NavDropdown label={t("assistance")} icon={ICON_NAV_RULES}>
						<Link href="/help" className="dropdown-item" role="menuitem">
							{t("helpCenter")}
						</Link>
						{session?.user ? (
							<Link
								href="/help/tickets"
								className="dropdown-item"
								role="menuitem"
							>
								{t("myTickets")}
							</Link>
						) : null}
						<Link href="/badges" className="dropdown-item" role="menuitem">
							{t("badges")}
						</Link>
						<Link href="/draw-badge" className="dropdown-item" role="menuitem">
							{t("drawBadge")}
						</Link>
					</NavDropdown>

					{session?.user ? (
						<>
							<Link href="/friends" className="nav-item">
								<Image
									src={ICON_NAV_GOODY}
									alt=""
									width={20}
									height={20}
									className="mr-1.5"
								/>
								{t("friends")}
							</Link>
							<Link href="/messages" className="nav-item">
								<Image
									src={ICON_NAV_BB}
									alt=""
									width={20}
									height={20}
									className="mr-1.5"
								/>
								{t("messages")}
							</Link>
						</>
					) : null}

					{showMod ? (
						<Link href="/mod" className="nav-item">
							<Image
								src="/assets/images/icons/navigation/home.png"
								alt=""
								width={20}
								height={20}
								className="mr-1.5"
							/>
							{t("mod")}
						</Link>
					) : null}

					{showAdmin ? (
						<Link href="/admin" className="nav-item">
							<Image
								src="/assets/images/icons/navigation/home.png"
								alt=""
								width={20}
								height={20}
								className="mr-1.5"
							/>
							{t("admin")}
						</Link>
					) : null}

					<div
						className="flex items-center gap-x-1 pt-2 mt-2 border-t"
						style={{
							borderColor:
								"color-mix(in srgb, var(--color-text-muted) 10%, transparent)",
						}}
					>
						<LanguageSwitcher />
						<NavbarColorPicker />
						<ThemeSwitcher />
					</div>
				</MobileNav>

				{/* Mobile: brand (right) */}
				<Link
					href="/"
					className="ml-auto flex md:hidden items-center gap-2 shrink-0"
					aria-label={t("home")}
				>
					<Image
						src="/assets/images/icons/navigation/home.png"
						alt=""
						width={26}
						height={26}
					/>
					<span
						className="text-base font-extrabold uppercase tracking-wide"
						style={{
							color:
								"var(--color-navbar-text-readable, var(--color-navbar-text))",
						}}
					>
						Atom
					</span>
				</Link>
			</div>
		</nav>
	);
}
