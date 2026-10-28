import { count, eq, gt, gte, sql } from "drizzle-orm";
import {
	ArrowLeftRight,
	Clock,
	DoorOpen,
	MessageSquare,
	TrendingUp,
	Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ban, db, queryRows, Rooms, RoomTradeLog, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { redisCache } from "@/lib/redis-cache";

const DashboardChart = dynamic(
	() =>
		import("@/components/admin/dashboard-chart").then((m) => ({
			default: m.DashboardChart,
		})),
	{
		loading: () => (
			<div className="animate-pulse bg-[var(--admin-surface)] rounded h-48" />
		),
	},
);

const PeakHoursHeatmap = dynamic(
	() =>
		import("@/components/admin/peak-hours-heatmap").then((m) => ({
			default: m.PeakHoursHeatmap,
		})),
	{
		loading: () => (
			<div className="animate-pulse bg-[var(--admin-surface)] rounded h-48" />
		),
	},
);

type AnalyticsData = {
	totalUsers: number;
	onlineUsers: number;
	weekRegistrations: number;
	monthRegistrations: number;
	totalRooms: number;
	activeRooms: number;
	weekChatMessages: number;
	weekTrades: number;
	weekBans: number;
	registrationChart: { label: string; value: number }[];
	peakHours: { grid: number[][]; max: number };
};

const EMPTY: AnalyticsData = {
	totalUsers: 0,
	onlineUsers: 0,
	weekRegistrations: 0,
	monthRegistrations: 0,
	totalRooms: 0,
	activeRooms: 0,
	weekChatMessages: 0,
	weekTrades: 0,
	weekBans: 0,
	registrationChart: [],
	peakHours: {
		grid: Array.from({ length: 7 }, () => Array(24).fill(0)),
		max: 0,
	},
};

async function safeCount(
	fn: () => Promise<number>,
): Promise<{ value: number; ok: boolean }> {
	try {
		return { value: await fn(), ok: true };
	} catch {
		return { value: 0, ok: false };
	}
}

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	return queryRows<T>(query);
}

async function getAnalyticsData(
	locale: string,
): Promise<{ data: AnalyticsData; degraded: boolean }> {
	const now = Math.floor(Date.now() / 1000);
	const todayStart = now - (now % 86400);
	const weekAgo = now - 7 * 86400;
	const monthAgo = now - 30 * 86400;
	let degraded = false;

	try {
		const [
			totalUsers,
			onlineUsers,
			weekRegistrations,
			monthRegistrations,
			totalRooms,
			activeRooms,
			weekChatMessages,
			weekTrades,
			weekBans,
		] = await Promise.all([
			safeCount(async () =>
				Number((await db.select({ total: count() }).from(User))[0]?.total ?? 0),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(User)
							.where(eq(User.online, "1"))
					)[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(User)
							.where(gte(User.accountCreated, weekAgo))
					)[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(User)
							.where(gte(User.accountCreated, monthAgo))
					)[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(await db.select({ total: count() }).from(Rooms))[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(Rooms)
							.where(gt(Rooms.users, 0))
					)[0]?.total ?? 0,
				),
			),
			(async () => {
				try {
					const rows = await rawRows<{ count: bigint }>(sql`
            SELECT COUNT(*) AS count FROM chatlogs_room WHERE timestamp >= ${weekAgo}`);
					return { value: Number(rows[0]?.count ?? 0), ok: true };
				} catch {
					return { value: 0, ok: false };
				}
			})(),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(RoomTradeLog)
							.where(gte(RoomTradeLog.timestamp, weekAgo))
					)[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(Ban)
							.where(gte(Ban.timestamp, weekAgo))
					)[0]?.total ?? 0,
				),
			),
		]);

		for (const r of [
			totalUsers,
			onlineUsers,
			weekRegistrations,
			monthRegistrations,
			totalRooms,
			activeRooms,
			weekChatMessages,
			weekTrades,
			weekBans,
		]) {
			if (!r.ok) degraded = true;
		}

		let registrationChart: { label: string; value: number }[] = [];
		try {
			const regRows = await rawRows<{ day_bucket: bigint; count: bigint }>(sql`
        SELECT FLOOR(account_created / 86400) AS day_bucket, COUNT(*) AS count
        FROM users
        WHERE account_created >= ${monthAgo}
        GROUP BY day_bucket ORDER BY day_bucket
      `);
			const regCountMap = new Map(
				regRows.map((r) => [Number(r.day_bucket), Number(r.count)]),
			);
			for (let i = 29; i >= 0; i--) {
				const dayStart = todayStart - i * 86400;
				const bucket = Math.floor(dayStart / 86400);
				const date = new Date(dayStart * 1000);
				registrationChart.push({
					label: date.toLocaleDateString(locale, {
						month: "short",
						day: "numeric",
					}),
					value: regCountMap.get(bucket) ?? 0,
				});
			}
		} catch {
			registrationChart = [];
			degraded = true;
		}

		const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
		let max = 0;
		try {
			const peakRows = await rawRows<{ d: number; h: number; c: bigint }>(sql`
        SELECT ((DAYOFWEEK(FROM_UNIXTIME(last_online)) + 5) % 7) AS d,
               HOUR(FROM_UNIXTIME(last_online)) AS h,
               COUNT(*) AS c
        FROM users
        WHERE last_online >= ${weekAgo}
        GROUP BY d, h
      `);
			for (const r of peakRows) {
				const day = Number(r.d);
				const hour = Number(r.h);
				if (day < 0 || day > 6 || hour < 0 || hour > 23) continue;
				const cnt = Number(r.c);
				grid[day][hour] = cnt;
				if (cnt > max) max = cnt;
			}
		} catch {
			degraded = true;
		}

		return {
			degraded,
			data: {
				totalUsers: totalUsers.value,
				onlineUsers: onlineUsers.value,
				weekRegistrations: weekRegistrations.value,
				monthRegistrations: monthRegistrations.value,
				totalRooms: totalRooms.value,
				activeRooms: activeRooms.value,
				weekChatMessages: weekChatMessages.value,
				weekTrades: weekTrades.value,
				weekBans: weekBans.value,
				registrationChart,
				peakHours: { grid, max },
			},
		};
	} catch {
		return { data: EMPTY, degraded: true };
	}
}

export default async function AnalyticsPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ANALYTICS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const locale = await getLocale();
	const t = await getTranslations("pages.admin.analytics");
	const { data, degraded } = await redisCache(
		`admin:analytics:overview:${locale}`,
		120,
		() => getAnalyticsData(locale),
	);

	return (
		<div className="space-y-6">
			{degraded ? (
				<div className="rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
					{t("loadError")}
				</div>
			) : null}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatsCard
					title={t("totalUsers")}
					value={data.totalUsers.toLocaleString(locale)}
					description={t("onlineNow", { count: data.onlineUsers })}
					icon={<Users className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("weekRegistrations")}
					value={data.weekRegistrations.toLocaleString(locale)}
					description={t("thisMonth", { count: data.monthRegistrations })}
					icon={<TrendingUp className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("activeRooms")}
					value={data.activeRooms.toLocaleString(locale)}
					description={t("totalRooms", { count: data.totalRooms })}
					icon={<DoorOpen className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("weeklyActivity")}
					value={data.weekChatMessages.toLocaleString(locale)}
					description={t("tradesAndBans", {
						trades: data.weekTrades,
						bans: data.weekBans,
					})}
					icon={<MessageSquare className="h-4 w-4" />}
				/>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<DashboardChart
					title={t("registrationsChartTitle")}
					data={data.registrationChart}
					color="hsl(262, 83%, 58%)"
					description={t("registrationsChartDescription")}
				/>
				<PeakHoursHeatmap data={data.peakHours} />
			</div>

			<div className="grid gap-6 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<MessageSquare className="h-4 w-4" /> {t("chatActivity")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">
							{data.weekChatMessages.toLocaleString(locale)}
						</div>
						<p className="text-sm text-muted-foreground">
							{t("messagesLast7Days")}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ArrowLeftRight className="h-4 w-4" /> {t("trades")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">
							{data.weekTrades.toLocaleString(locale)}
						</div>
						<p className="text-sm text-muted-foreground">
							{t("tradesLast7Days")}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Clock className="h-4 w-4" /> {t("retention")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">
							{data.totalUsers > 0
								? Math.round((data.onlineUsers / data.totalUsers) * 100)
								: 0}
							%
						</div>
						<p className="text-sm text-muted-foreground">
							{t("usersOnlineOverTotal")}
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
