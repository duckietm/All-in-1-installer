import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { ArrowLeftRight } from "lucide-react";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StatsCard } from "@/components/admin/stats-card";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	db,
	LogsShopPurchases,
	MarketplaceItems,
	queryRows,
	RoomTradeLog,
	User,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { redisCache } from "@/lib/redis-cache";

const RevenueChart = dynamic(
	() =>
		import("@/components/admin/revenue-chart").then((m) => ({
			default: m.RevenueChart,
		})),
	{
		loading: () => (
			<div className="animate-pulse bg-[var(--admin-surface)] rounded h-48" />
		),
	},
);

type EconomyData = {
	totalCredits: number;
	totalPixels: number;
	totalPoints: number;
	shopPurchases: number;
	shopCreditsSpent: number;
	shopPointsSpent: number;
	marketplaceActive: number;
	marketplaceSold: number;
	weekTrades: number;
	revenueData: { label: string; credits: number; points: number }[];
};

const EMPTY: EconomyData = {
	totalCredits: 0,
	totalPixels: 0,
	totalPoints: 0,
	shopPurchases: 0,
	shopCreditsSpent: 0,
	shopPointsSpent: 0,
	marketplaceActive: 0,
	marketplaceSold: 0,
	weekTrades: 0,
	revenueData: [],
};

async function safeCount(fn: () => Promise<number>): Promise<number> {
	try {
		return await fn();
	} catch {
		return 0;
	}
}

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	return queryRows<T>(query);
}

async function getEconomyData(
	locale: string,
): Promise<{ data: EconomyData; degraded: boolean }> {
	const now = Math.floor(Date.now() / 1000);
	const todayStart = now - (now % 86400);
	const weekAgo = now - 7 * 86400;
	const rangeStart = todayStart - 6 * 86400;
	let degraded = false;

	try {
		const [creditsAgg, pixelsAgg, pointsAgg] = await Promise.all([
			db
				.select({ total: sum(User.credits) })
				.from(User)
				.catch(() => {
					degraded = true;
					return [{ total: null }];
				}),
			db
				.select({ total: sum(User.pixels) })
				.from(User)
				.catch(() => {
					degraded = true;
					return [{ total: null }];
				}),
			db
				.select({ total: sum(User.points) })
				.from(User)
				.catch(() => {
					degraded = true;
					return [{ total: null }];
				}),
		]);
		const totalCredits = Number(creditsAgg[0]?.total ?? 0);
		const totalPixels = Number(pixelsAgg[0]?.total ?? 0);
		const totalPoints = Number(pointsAgg[0]?.total ?? 0);

		let shopPurchases = 0;
		let shopCreditsSpent = 0;
		let shopPointsSpent = 0;
		try {
			const [shopRevenue] = await db
				.select({
					purchases: count(),
					credits: sum(LogsShopPurchases.costCredits),
					points: sum(LogsShopPurchases.costPoints),
				})
				.from(LogsShopPurchases)
				.where(gte(LogsShopPurchases.timestamp, weekAgo));
			shopPurchases = Number(shopRevenue?.purchases ?? 0);
			shopCreditsSpent = Number(shopRevenue?.credits ?? 0);
			shopPointsSpent = Number(shopRevenue?.points ?? 0);
		} catch {
			degraded = true;
		}

		const [marketplaceActive, marketplaceSold, weekTrades] = await Promise.all([
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(MarketplaceItems)
							.where(eq(MarketplaceItems.state, 1))
					)[0]?.total ?? 0,
				),
			),
			safeCount(async () =>
				Number(
					(
						await db
							.select({ total: count() })
							.from(MarketplaceItems)
							.where(
								and(
									eq(MarketplaceItems.state, 2),
									gte(MarketplaceItems.soldTimestamp, weekAgo),
								),
							)
					)[0]?.total ?? 0,
				),
			),
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
		]);

		const revenueData: EconomyData["revenueData"] = [];
		for (let i = 6; i >= 0; i--) {
			const dayStart = todayStart - i * 86400;
			const date = new Date(dayStart * 1000);
			revenueData.push({
				label: date.toLocaleDateString(locale, { weekday: "short" }),
				credits: 0,
				points: 0,
			});
		}

		try {
			const revRows = await rawRows<{
				day_bucket: bigint;
				credits: number | bigint;
				points: number | bigint;
			}>(sql`
        SELECT FLOOR(timestamp / 86400) AS day_bucket,
               COALESCE(SUM(cost_credits), 0) AS credits,
               COALESCE(SUM(cost_points), 0) AS points
        FROM logs_shop_purchases
        WHERE timestamp >= ${rangeStart}
        GROUP BY day_bucket ORDER BY day_bucket
      `);
			const revMap = new Map(
				revRows.map((r) => [
					Number(r.day_bucket),
					{ credits: Number(r.credits), points: Number(r.points) },
				]),
			);
			for (let i = 0; i < revenueData.length; i++) {
				const dayStart = todayStart - (6 - i) * 86400;
				const bucket = Math.floor(dayStart / 86400);
				const entry = revMap.get(bucket);
				if (entry) {
					revenueData[i] = { ...revenueData[i], ...entry };
				}
			}
		} catch {
			degraded = true;
		}

		return {
			degraded,
			data: {
				totalCredits,
				totalPixels,
				totalPoints,
				shopPurchases,
				shopCreditsSpent,
				shopPointsSpent,
				marketplaceActive,
				marketplaceSold,
				weekTrades,
				revenueData,
			},
		};
	} catch {
		return { data: EMPTY, degraded: true };
	}
}

export default async function EconomyPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ANALYTICS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const locale = await getLocale();
	const t = await getTranslations("pages.admin.analytics.economy");
	const tRoot = await getTranslations("pages.admin.analytics");
	const { data, degraded } = await redisCache(
		`admin:analytics:economy:${locale}`,
		120,
		() => getEconomyData(locale),
	);

	return (
		<div className="space-y-6">
			{degraded ? (
				<div className="rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
					{tRoot("loadError")}
				</div>
			) : null}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatsCard
					title={t("creditsInCirculation")}
					value={data.totalCredits.toLocaleString(locale)}
					description={t("creditsDescription")}
					icon={<CurrencyIcon kind="credits" size={16} />}
				/>
				<StatsCard
					title={t("pixelsInCirculation")}
					value={data.totalPixels.toLocaleString(locale)}
					description={t("pixelsDescription")}
					icon={<CurrencyIcon kind="pixels" size={16} />}
				/>
				<StatsCard
					title={t("pointsInCirculation")}
					value={data.totalPoints.toLocaleString(locale)}
					description={t("pointsDescription")}
					icon={<CurrencyIcon kind="diamonds" size={16} />}
				/>
				<StatsCard
					title={t("weeklyTrades")}
					value={data.weekTrades.toLocaleString(locale)}
					description={t("marketplaceListings", {
						count: data.marketplaceActive,
					})}
					icon={<ArrowLeftRight className="h-4 w-4" />}
				/>
			</div>

			<RevenueChart data={data.revenueData} />

			<div className="grid gap-6 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle>{t("shopRevenueTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t("purchases")}</span>
								<span className="font-medium">{data.shopPurchases}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">
									{t("creditsSpent")}
								</span>
								<span className="font-medium">
									{data.shopCreditsSpent.toLocaleString(locale)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">
									{t("pointsSpent")}
								</span>
								<span className="font-medium">
									{data.shopPointsSpent.toLocaleString(locale)}
								</span>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("marketplaceTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<div className="flex justify-between">
								<span className="text-muted-foreground">
									{t("activeListings")}
								</span>
								<span className="font-medium">{data.marketplaceActive}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t("sold7d")}</span>
								<span className="font-medium">{data.marketplaceSold}</span>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("currencyDistributionTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t("credits")}</span>
								<span className="font-medium">
									{data.totalCredits.toLocaleString(locale)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t("pixels")}</span>
								<span className="font-medium">
									{data.totalPixels.toLocaleString(locale)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t("points")}</span>
								<span className="font-medium">
									{data.totalPoints.toLocaleString(locale)}
								</span>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
