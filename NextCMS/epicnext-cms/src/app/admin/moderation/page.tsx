import { and, count, desc, eq, gte, inArray, like } from "drizzle-orm";
import {
	AlertTriangle,
	Ban as BanIcon,
	Clock,
	Gavel,
	Radio,
	Shield,
	User as UserIcon,
} from "lucide-react";
import { redirect } from "next/navigation";
import { StatsCard } from "@/components/admin/stats-card";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import { AdminAuditLog, Ban, db, SupportTickets, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";

const CFH_STATES: Record<number, { label: string; class: string }> = {
	0: {
		label: "Open",
		class: "bg-[var(--admin-error-subtle)] text-[var(--admin-error)]",
	},
	1: {
		label: "Picked",
		class: "bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)]",
	},
	2: { label: "Closed", class: "bg-muted text-muted-foreground" },
};

export default async function ModerationDashboard() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.MODERATION_VIEW, session.user.rank))
		redirect("/admin");

	const now = Math.floor(Date.now() / 1000);
	const todayStart = now - (now % 86400);
	const minStaffRank = await getMinStaffRank();

	const [
		openCfh,
		pickedCfh,
		todayBans,
		modsOnlineRows,
		recentCfh,
		recentModActions,
	] = await Promise.all([
		getCachedAdminCount(
			SupportTickets,
			"moderation_open_cfh",
			eq(SupportTickets.state, 0),
			{ cacheFiltered: true },
		),
		getCachedAdminCount(
			SupportTickets,
			"moderation_picked_cfh",
			eq(SupportTickets.state, 1),
			{ cacheFiltered: true },
		),
		getCachedAdminCount(
			Ban,
			"moderation_today_bans",
			gte(Ban.timestamp, todayStart),
			{ cacheFiltered: true },
		),
		db
			.select({ total: count() })
			.from(User)
			.where(and(eq(User.online, "1"), gte(User.rank, minStaffRank))),
		db.select().from(SupportTickets).orderBy(desc(SupportTickets.id)).limit(10),
		db
			.select({
				id: AdminAuditLog.id,
				action: AdminAuditLog.action,
				details: AdminAuditLog.details,
				createdAt: AdminAuditLog.createdAt,
				userId: AdminAuditLog.userId,
				target: AdminAuditLog.target,
				targetId: AdminAuditLog.targetId,
				username: User.username,
			})
			.from(AdminAuditLog)
			.leftJoin(User, eq(AdminAuditLog.userId, User.id))
			.where(like(AdminAuditLog.action, "mod_%"))
			.orderBy(desc(AdminAuditLog.id))
			.limit(10),
	]);

	const modsOnline = Number(modsOnlineRows[0]?.total ?? 0);

	// Fetch usernames for CFH tickets
	const userIds = [
		...new Set([
			...recentCfh.map((t) => t.senderId),
			...recentCfh.map((t) => t.reportedId),
			...recentCfh.map((t) => t.modId),
		]),
	].filter(Boolean) as number[];

	const users =
		userIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, userIds))
			: [];
	const userMap = new Map(users.map((u) => [u.id, u.username]));

	return (
		<div className="space-y-6">
			{/* Stats */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatsCard
					title="Open CFH"
					value={openCfh}
					description={`${pickedCfh} picked`}
					icon={<Radio className="h-4 w-4" />}
					href="/admin/moderation/cfh"
				/>
				<StatsCard
					title="Bans Today"
					value={todayBans}
					icon={<BanIcon className="h-4 w-4" />}
					href="/admin/bans"
				/>
				<StatsCard
					title="Mods Online"
					value={modsOnline}
					icon={<Shield className="h-4 w-4" />}
					href="/admin/moderation/team"
				/>
				<StatsCard
					title="Quick Actions"
					value="→"
					description="Kick, mute, alert"
					icon={<Gavel className="h-4 w-4" />}
					href="/admin/moderation/actions"
				/>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Recent CFH */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center justify-between">
							<span className="flex items-center gap-2">
								<AlertTriangle className="h-4 w-4 text-[var(--admin-error)]" />
								Recent CFH Tickets
							</span>
							<Link
								href="/admin/moderation/cfh"
								className="text-xs font-normal text-primary hover:underline"
							>
								View all
							</Link>
						</CardTitle>
					</CardHeader>
					<CardContent>
						{recentCfh.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								No CFH tickets
							</p>
						) : (
							<div className="divide-y divide-border">
								{recentCfh.map((ticket) => {
									const state = CFH_STATES[ticket.state] ?? CFH_STATES[0];
									return (
										<Link
											key={ticket.id}
											href={`/admin/moderation/cfh/${ticket.id}`}
											className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 hover:bg-accent/50 -mx-2 px-2 rounded transition-colors"
										>
											<span className="text-xs font-mono text-muted-foreground w-8">
												#{ticket.id}
											</span>
											<div className="flex-1 min-w-0">
												<p className="text-sm truncate">
													{ticket.issue || "No description"}
												</p>
												<p className="text-xs text-muted-foreground">
													{userMap.get(ticket.senderId) ?? "?"} →{" "}
													{userMap.get(ticket.reportedId) ?? "?"}
												</p>
											</div>
											<Badge className={`text-[10px] ${state.class}`}>
												{state.label}
											</Badge>
										</Link>
									);
								})}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Recent Mod Actions */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Clock className="h-4 w-4" />
							Recent Mod Actions
						</CardTitle>
					</CardHeader>
					<CardContent>
						{recentModActions.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								No recent actions
							</p>
						) : (
							<div className="divide-y divide-border">
								{recentModActions.map((log) => (
									<div
										key={log.id}
										className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
									>
										<UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">
												{log.action.replace("mod_", "").replace(/_/g, " ")}
											</p>
											<p className="text-xs text-muted-foreground">
												by {log.username ?? "?"} · {log.target}{" "}
												{log.targetId ? `#${log.targetId}` : ""}
											</p>
										</div>
										<span className="text-[10px] text-muted-foreground whitespace-nowrap">
											{log.createdAt}
										</span>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
