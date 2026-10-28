import { and, count, eq, gte, ne } from "drizzle-orm";
import {
	Ban,
	Gavel,
	LifeBuoy,
	Radio,
	Shield,
	Ticket,
	Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatsCard } from "@/components/admin/stats-card";
import Link from "@/components/link";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import {
	Ban as BanTable,
	db,
	SupportTickets,
	User,
	WebsiteHelpCenterTickets,
	WebsiteTicket,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function ModDashboardPage() {
	const t = await getTranslations("pages.mod");
	const { session, permissions } = await getAdminContext();
	const rank = session.user.rank;
	const now = Math.floor(Date.now() / 1000);
	const todayStart = now - (now % 86400);
	const minStaffRank = await getMinStaffRank();

	const showCfh =
		canAccess(permissions, PERMS.MOD_CFH_VIEW, rank) ||
		canAccess(permissions, PERMS.MODERATION_VIEW, rank);
	const showActions =
		canAccess(permissions, PERMS.MOD_ACTIONS, rank) ||
		canAccess(permissions, PERMS.MODERATION_EDIT, rank);
	const showBans =
		canAccess(permissions, PERMS.MOD_BANS_VIEW, rank) ||
		canAccess(permissions, PERMS.BANS_VIEW, rank);
	const showTickets =
		canAccess(permissions, PERMS.MOD_TICKETS_VIEW, rank) ||
		canAccess(permissions, PERMS.TICKETS_VIEW, rank);
	const showTeam =
		canAccess(permissions, PERMS.MOD_TEAM_VIEW, rank) ||
		canAccess(permissions, PERMS.MODERATION_VIEW, rank);
	const showUsers =
		canAccess(permissions, PERMS.MOD_USERS_VIEW, rank) ||
		canAccess(permissions, PERMS.USERS_VIEW, rank);

	const [openCfh, todayBans, modsOnline, openTickets, openHelpTickets] =
		await Promise.all([
			showCfh
				? db
						.select({ total: count() })
						.from(SupportTickets)
						.where(eq(SupportTickets.state, 0))
						.then((rows) => rows[0]?.total ?? 0)
						.catch(() => 0)
				: Promise.resolve(0),
			showBans
				? db
						.select({ total: count() })
						.from(BanTable)
						.where(gte(BanTable.timestamp, todayStart))
						.then((rows) => rows[0]?.total ?? 0)
						.catch(() => 0)
				: Promise.resolve(0),
			db
				.select({ total: count() })
				.from(User)
				.where(and(eq(User.online, "1"), gte(User.rank, minStaffRank)))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			showTickets
				? db
						.select({ total: count() })
						.from(WebsiteTicket)
						.where(ne(WebsiteTicket.status, "closed"))
						.then((rows) => rows[0]?.total ?? 0)
						.catch(() => 0)
				: Promise.resolve(0),
			showTickets
				? db
						.select({ total: count() })
						.from(WebsiteHelpCenterTickets)
						.where(eq(WebsiteHelpCenterTickets.open, true))
						.then((rows) => rows[0]?.total ?? 0)
						.catch(() => 0)
				: Promise.resolve(0),
		]);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="admin-section-title m-0">{t("overviewTitle")}</h2>
				<p className="mt-1 text-sm text-[var(--admin-text-muted)]">
					{t("overviewSubtitle")}
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{showCfh ? (
					<StatsCard
						title={t("stats.openCfh")}
						value={openCfh}
						icon={<Radio className="h-4 w-4" />}
						href="/mod/cfh"
					/>
				) : null}
				{showTickets ? (
					<StatsCard
						title={t("stats.openTickets")}
						value={openTickets}
						icon={<Ticket className="h-4 w-4" />}
						href="/mod/tickets"
					/>
				) : null}
				{showTickets ? (
					<StatsCard
						title={t("stats.openHelpTickets")}
						value={openHelpTickets}
						icon={<LifeBuoy className="h-4 w-4" />}
						href="/mod/help-tickets"
					/>
				) : null}
				{showBans ? (
					<StatsCard
						title={t("stats.bansToday")}
						value={todayBans}
						icon={<Ban className="h-4 w-4" />}
						href="/mod/bans"
					/>
				) : null}
				<StatsCard
					title={t("stats.modsOnline")}
					value={modsOnline}
					icon={<Shield className="h-4 w-4" />}
					href={showTeam ? "/mod/team" : undefined}
				/>
				{showActions ? (
					<StatsCard
						title={t("stats.quickActions")}
						value="→"
						description={t("stats.quickActionsHint")}
						icon={<Gavel className="h-4 w-4" />}
						href="/mod/actions"
					/>
				) : null}
				{showTeam ? (
					<StatsCard
						title={t("stats.team")}
						value="→"
						description={t("stats.teamHint")}
						icon={<Users className="h-4 w-4" />}
						href="/mod/team"
					/>
				) : null}
			</div>

			<section className="admin-card space-y-2 p-4">
				<h3 className="m-0 text-sm font-semibold">{t("shortcutsTitle")}</h3>
				<ul className="m-0 list-none space-y-1 p-0 text-sm">
					{showCfh ? (
						<li>
							<Link href="/mod/cfh" className="text-primary hover:underline">
								{t("nav.cfh")}
							</Link>
						</li>
					) : null}
					{showTickets ? (
						<>
							<li>
								<Link
									href="/mod/tickets"
									className="text-primary hover:underline"
								>
									{t("nav.tickets")}
								</Link>
							</li>
							<li>
								<Link
									href="/mod/help-tickets"
									className="text-primary hover:underline"
								>
									{t("nav.helpTickets")}
								</Link>
							</li>
						</>
					) : null}
					{showActions ? (
						<li>
							<Link
								href="/mod/actions"
								className="text-primary hover:underline"
							>
								{t("nav.actions")}
							</Link>
						</li>
					) : null}
					{showBans ? (
						<li>
							<Link href="/mod/bans" className="text-primary hover:underline">
								{t("nav.bans")}
							</Link>
						</li>
					) : null}
					{showUsers ? (
						<li>
							<Link href="/mod/users" className="text-primary hover:underline">
								{t("nav.users")}
							</Link>
						</li>
					) : null}
					{showTeam ? (
						<li>
							<Link href="/mod/team" className="text-primary hover:underline">
								{t("nav.team")}
							</Link>
						</li>
					) : null}
				</ul>
			</section>
		</div>
	);
}
