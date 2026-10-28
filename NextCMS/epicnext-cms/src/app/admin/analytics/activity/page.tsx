import { count, gte, inArray, sql } from "drizzle-orm";
import { MessageSquare, Shield, Terminal, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ban, db, queryRows, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { redisCache } from "@/lib/redis-cache";

type DayRow = {
	label: string;
	chats: number;
	commands: number;
	bans: number;
	registrations: number;
};

type ActivityData = {
	dailyData: DayRow[];
	weekChats: number;
	weekCommands: number;
	weekBans: number;
	weekRegistrations: number;
	topChatters: { userId: number; username: string; messages: number }[];
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

async function safeRawCount(
	query: ReturnType<typeof sql>,
): Promise<{ value: number; ok: boolean }> {
	try {
		const rows = await rawRows<{ count: bigint }>(query);
		return { value: Number(rows[0]?.count ?? 0), ok: true };
	} catch {
		return { value: 0, ok: false };
	}
}

async function getActivityData(
	locale: string,
): Promise<ActivityData & { degraded: boolean }> {
	const now = Math.floor(Date.now() / 1000);
	const todayStart = now - (now % 86400);
	const weekAgo = now - 7 * 86400;
	const rangeStart = todayStart - 6 * 86400;
	let degraded = false;

	const emptyDays: DayRow[] = [];
	for (let i = 6; i >= 0; i--) {
		const dayStart = todayStart - i * 86400;
		const date = new Date(dayStart * 1000);
		emptyDays.push({
			label: date.toLocaleDateString(locale, {
				weekday: "short",
				month: "short",
				day: "numeric",
			}),
			chats: 0,
			commands: 0,
			bans: 0,
			registrations: 0,
		});
	}

	const toMap = (rows: { day_bucket: bigint; count: bigint }[]) =>
		new Map(rows.map((r) => [Number(r.day_bucket), Number(r.count)]));

	let chatMap = new Map<number, number>();
	let cmdMap = new Map<number, number>();
	let banMap = new Map<number, number>();
	let regMap = new Map<number, number>();

	try {
		const [chatRows, cmdRows, banRows, regRows] = await Promise.all([
			rawRows<{ day_bucket: bigint; count: bigint }>(sql`
        SELECT FLOOR(timestamp / 86400) AS day_bucket, COUNT(*) AS count
        FROM chatlogs_room WHERE timestamp >= ${rangeStart} GROUP BY day_bucket`).catch(
				() => [],
			),
			rawRows<{ day_bucket: bigint; count: bigint }>(sql`
        SELECT FLOOR(timestamp / 86400) AS day_bucket, COUNT(*) AS count
        FROM commandlogs WHERE timestamp >= ${rangeStart} GROUP BY day_bucket`).catch(
				() => [],
			),
			rawRows<{ day_bucket: bigint; count: bigint }>(sql`
        SELECT FLOOR(timestamp / 86400) AS day_bucket, COUNT(*) AS count
        FROM bans WHERE timestamp >= ${rangeStart} GROUP BY day_bucket`).catch(
				() => [],
			),
			rawRows<{ day_bucket: bigint; count: bigint }>(sql`
        SELECT FLOOR(account_created / 86400) AS day_bucket, COUNT(*) AS count
        FROM users WHERE account_created >= ${rangeStart} GROUP BY day_bucket`).catch(
				() => [],
			),
		]);
		chatMap = toMap(chatRows);
		cmdMap = toMap(cmdRows);
		banMap = toMap(banRows);
		regMap = toMap(regRows);
	} catch {
		degraded = true;
	}

	const dailyData = emptyDays.map((day, idx) => {
		const dayStart = todayStart - (6 - idx) * 86400;
		const bucket = Math.floor(dayStart / 86400);
		return {
			...day,
			chats: chatMap.get(bucket) ?? 0,
			commands: cmdMap.get(bucket) ?? 0,
			bans: banMap.get(bucket) ?? 0,
			registrations: regMap.get(bucket) ?? 0,
		};
	});

	const [weekChats, weekCommands, weekBans, weekRegistrations] =
		await Promise.all([
			safeRawCount(sql`
          SELECT COUNT(*) AS count FROM chatlogs_room WHERE timestamp >= ${weekAgo}`),
			safeRawCount(sql`
          SELECT COUNT(*) AS count FROM commandlogs WHERE timestamp >= ${weekAgo}`),
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
		]);

	for (const r of [weekChats, weekCommands, weekBans, weekRegistrations]) {
		if (!r.ok) degraded = true;
	}

	let topChatters: ActivityData["topChatters"] = [];
	try {
		const rows = await rawRows<{ userId: number; messages: bigint }>(sql`
      SELECT user_from_id AS userId, COUNT(*) AS messages
      FROM chatlogs_room WHERE timestamp >= ${weekAgo}
      GROUP BY user_from_id ORDER BY messages DESC LIMIT 10
    `);
		const userIds = rows.map((c) => Number(c.userId)).filter((n) => n > 0);
		const users =
			userIds.length > 0
				? await db
						.select({ id: User.id, username: User.username })
						.from(User)
						.where(inArray(User.id, userIds))
				: [];
		const userMap = new Map(users.map((u) => [u.id, u.username]));
		topChatters = rows.map((c) => {
			const userId = Number(c.userId);
			return {
				userId,
				username: userMap.get(userId) ?? "",
				messages: Number(c.messages),
			};
		});
	} catch {
		topChatters = [];
		degraded = true;
	}

	return {
		dailyData,
		weekChats: weekChats.value,
		weekCommands: weekCommands.value,
		weekBans: weekBans.value,
		weekRegistrations: weekRegistrations.value,
		topChatters,
		degraded,
	};
}

export default async function ActivityPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ANALYTICS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const locale = await getLocale();
	const t = await getTranslations("pages.admin.analytics.activity");
	const tRoot = await getTranslations("pages.admin.analytics");
	const data = await redisCache(`admin:analytics:activity:${locale}`, 120, () =>
		getActivityData(locale),
	);

	return (
		<div className="space-y-6">
			{data.degraded ? (
				<div className="rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
					{tRoot("loadError")}
				</div>
			) : null}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatsCard
					title={t("chatMessages")}
					value={data.weekChats.toLocaleString(locale)}
					description={t("last7Days")}
					icon={<MessageSquare className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("commands")}
					value={data.weekCommands.toLocaleString(locale)}
					description={t("last7Days")}
					icon={<Terminal className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("bans")}
					value={data.weekBans.toLocaleString(locale)}
					description={t("last7Days")}
					icon={<Shield className="h-4 w-4" />}
				/>
				<StatsCard
					title={t("registrations")}
					value={data.weekRegistrations.toLocaleString(locale)}
					description={t("last7Days")}
					icon={<Users className="h-4 w-4" />}
				/>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("dailyBreakdownTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-muted-foreground">
										<th className="text-left py-2 font-medium">
											{t("colDay")}
										</th>
										<th className="text-right py-2 font-medium">
											{t("colChats")}
										</th>
										<th className="text-right py-2 font-medium">
											{t("colCmds")}
										</th>
										<th className="text-right py-2 font-medium">
											{t("colBans")}
										</th>
										<th className="text-right py-2 font-medium">
											{t("colRegs")}
										</th>
									</tr>
								</thead>
								<tbody>
									{data.dailyData.map((day) => (
										<tr key={day.label} className="border-b last:border-0">
											<td className="py-2">{day.label}</td>
											<td className="text-right tabular-nums">
												{day.chats.toLocaleString(locale)}
											</td>
											<td className="text-right tabular-nums">
												{day.commands.toLocaleString(locale)}
											</td>
											<td className="text-right tabular-nums">{day.bans}</td>
											<td className="text-right tabular-nums">
												{day.registrations}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("mostActiveUsersTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						{data.topChatters.length === 0 ? (
							<div className="admin-empty">{t("noChatActivity")}</div>
						) : (
							<div className="divide-y">
								{data.topChatters.map((user, i) => (
									<div
										key={user.userId}
										className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
									>
										<span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold">
											{i + 1}
										</span>
										<span className="flex-1 text-sm font-medium">
											{user.username || t("userFallback", { id: user.userId })}
										</span>
										<span className="text-sm tabular-nums text-muted-foreground">
											{t("msgCount", {
												count: user.messages.toLocaleString(locale),
											})}
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
