import { count, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
	Activity,
	ArrowRight,
	Ban as BanIcon,
	Database,
	Newspaper,
	Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminWorkQueue } from "@/components/admin/admin-work-queue";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { unixNow } from "@/lib/bans";
import { Ban, db, StaffActivities, User, WebsiteArticles } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { logServerError } from "@/lib/server-log";

type RankCount = { rank: number; count: number };

export default async function AdminDashboard() {
	const t = await getTranslations("pages.admin.dashboard");
	const now = unixNow();
	let users = -1;
	let online = 0;
	let articles = 0;
	let bans = 0;
	try {
		const [usersRow, onlineRow, articlesRow, bansRow] = await Promise.all([
			db.select({ total: count() }).from(User),
			db.select({ total: count() }).from(User).where(eq(User.online, "1")),
			db.select({ total: count() }).from(WebsiteArticles),
			db
				.select({ total: count() })
				.from(Ban)
				.where(or(eq(Ban.banExpire, 0), gt(Ban.banExpire, now))),
		]);
		users = usersRow[0]?.total ?? 0;
		online = onlineRow[0]?.total ?? 0;
		articles = articlesRow[0]?.total ?? 0;
		bans = bansRow[0]?.total ?? 0;
	} catch (error) {
		logServerError("admin.dashboard_stats_failed", error);
	}
	const dbOk = users >= 0;

	const rankGroups = await db
		.select({ rank: User.rank, total: count() })
		.from(User)
		.groupBy(User.rank)
		.orderBy(desc(User.rank))
		.catch(() => [] as Array<{ rank: number; total: number }>);
	const rankCounts: RankCount[] = rankGroups
		.map((g) => ({ rank: g.rank, count: Number(g.total) }))
		.sort((a, b) => b.count - a.count);
	const maxRankCount = rankCounts.reduce((m, r) => Math.max(m, r.count), 0);

	const activity = await db
		.select()
		.from(StaffActivities)
		.orderBy(desc(StaffActivities.createdAt))
		.limit(8)
		.catch(() => [] as (typeof StaffActivities.$inferSelect)[]);
	const staffIds = Array.from(
		new Set(activity.map((a) => Number(a.userId))),
	).filter((n) => n > 0);
	let nameById = new Map<number, string>();
	if (staffIds.length) {
		const u = await db
			.select({ id: User.id, username: User.username })
			.from(User)
			.where(inArray(User.id, staffIds))
			.catch(() => []);
		nameById = new Map(u.map((x) => [x.id, x.username]));
	}

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Activity size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("title")}
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						{t("subtitle")}
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
				<Link
					href="/admin/commandocentrum#online"
					className="no-underline text-inherit"
				>
					<StatusCard
						label={t("playersOnline")}
						value={online}
						hint={
							dbOk
								? `${t("totalAccounts", { count: users })} · live roster →`
								: t("databaseDown")
						}
						state={dbOk ? "neutral" : "danger"}
						icon={<Users size={18} />}
					/>
				</Link>
				<StatusCard
					label={t("articles")}
					value={dbOk ? articles : "—"}
					state="neutral"
					icon={<Newspaper size={18} />}
				/>
				<StatusCard
					label={t("activeBans")}
					value={dbOk ? bans : "—"}
					state={bans > 0 ? "warn" : "neutral"}
					icon={<BanIcon size={18} />}
				/>
				<StatusCard
					label={t("database")}
					value={dbOk ? t("databaseConnected") : t("databaseDown")}
					state={dbOk ? "ok" : "danger"}
					icon={<Database size={18} />}
				/>
			</div>

			<AdminWorkQueue />
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<section className="admin-card p-5">
					<h2 className="text-sm font-bold text-[var(--admin-text)] mb-4 admin-section-title">
						{t("usersByRank")}
					</h2>
					{rankCounts.length === 0 ? (
						<p className="text-xs text-[var(--admin-text-muted)]">
							{dbOk ? t("noAccountsToBreakDown") : t("databaseDown")}
						</p>
					) : (
						<div className="space-y-2.5">
							{rankCounts.map((r) => {
								const pct =
									maxRankCount > 0
										? Math.round((r.count / maxRankCount) * 100)
										: 0;
								return (
									<div
										key={r.rank}
										className="grid items-center gap-3"
										style={{ gridTemplateColumns: "5rem 1fr 2.5rem" }}
									>
										<span className="text-xs font-medium text-[var(--admin-text-muted)]">
											{t("rankLabel", { rank: r.rank })}
										</span>
										<div
											className="h-3 rounded-md overflow-hidden bg-[var(--admin-accent)]/10"
											role="img"
											aria-label={t("rankWithCount", {
												rank: r.rank,
												count: r.count,
											})}
										>
											<div
												className="h-full rounded-md bg-gradient-to-r from-[var(--admin-accent)] to-[var(--admin-accent)] transition-all duration-500"
												style={{
													width: `${Math.max(pct, r.count > 0 ? 4 : 0)}%`,
												}}
											/>
										</div>
										<strong className="text-xs text-right text-[var(--admin-text-muted)]">
											{r.count}
										</strong>
									</div>
								);
							})}
						</div>
					)}
				</section>

				<section className="admin-card p-5">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-sm font-bold text-[var(--admin-text)] admin-section-title">
							{t("recentStaffActivity")}
						</h2>
						<Link
							href="/admin/logs"
							className="text-xs font-medium text-[var(--admin-accent)] hover:text-[var(--admin-accent)] flex items-center gap-1 no-underline"
						>
							{t("viewAll")} <ArrowRight size={12} />
						</Link>
					</div>
					{activity.length === 0 ? (
						<p className="text-xs text-[var(--admin-text-muted)]">
							{t("noStaffActivityLogged")}
						</p>
					) : (
						<div className="space-y-0">
							{activity.map((a, i) => (
								<div
									key={String(a.id)}
									className={`flex items-center gap-3 py-2.5 ${i > 0 ? "border-t border-[var(--admin-border)]" : ""}`}
								>
									<div className="w-7 h-7 rounded-full bg-[var(--admin-accent)]/10 grid place-items-center flex-none">
										<Activity
											size={12}
											className="text-[var(--admin-accent)]"
										/>
									</div>
									<div className="flex-1 min-w-0">
										<div className="text-sm font-medium text-[var(--admin-text)] truncate">
											{nameById.get(Number(a.userId)) ?? `#${a.userId}`}
										</div>
										<div className="text-xs text-[var(--admin-text-muted)] truncate">
											{a.description}
										</div>
									</div>
									<div className="text-right flex-none">
										<span className="inline-block text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)] admin-card inline-flex items-center justify-center min-w-[60px]">
											{a.action}
										</span>
										<div className="text-[0.6rem] text-[var(--admin-text-muted)] mt-0.5">
											{formatDate(a.createdAt)}
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
