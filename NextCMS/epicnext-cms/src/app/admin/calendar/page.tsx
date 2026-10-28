import { count, desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { CalendarCampaigns, CalendarRewards, db } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type Campaign = {
	id: number;
	name: string;
	image: string;
	startTimestamp: number;
	totalDays: number;
	lockExpired: string;
	enabled: string;
};

export default async function AdminCalendar() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.calendar");

	let campaigns: Campaign[] = [];
	let loadError = false;
	try {
		campaigns = await db
			.select({
				id: CalendarCampaigns.id,
				name: CalendarCampaigns.name,
				image: CalendarCampaigns.image,
				startTimestamp: CalendarCampaigns.startTimestamp,
				totalDays: CalendarCampaigns.totalDays,
				lockExpired: CalendarCampaigns.lockExpired,
				enabled: CalendarCampaigns.enabled,
			})
			.from(CalendarCampaigns)
			.orderBy(desc(CalendarCampaigns.id))
			.limit(200);
	} catch {
		campaigns = [];
		loadError = true;
	}

	const rewardCounts = new Map<number, number>();
	let totalRewards = 0;
	try {
		const grouped = await db
			.select({
				campaignId: CalendarRewards.campaignId,
				total: count(),
			})
			.from(CalendarRewards)
			.groupBy(CalendarRewards.campaignId);
		for (const g of grouped) {
			rewardCounts.set(g.campaignId, Number(g.total));
			totalRewards += Number(g.total);
		}
	} catch {
		loadError = true;
	}

	const enabledCount = campaigns.filter((c) => c.enabled === "1").length;

	return (
		<main>
			{loadError ? (
				<div className="mb-4 rounded-lg bg-[var(--admin-error-subtle)] p-3 text-xs text-[var(--admin-error)]">
					Could not load some calendar data (database unavailable).
				</div>
			) : null}
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("campaigns")} value={campaigns.length} icon="📅" />
				<StatusCard
					label={t("enabled")}
					value={enabledCount}
					state={enabledCount > 0 ? "ok" : "neutral"}
					icon="✅"
				/>
				<StatusCard label={t("totalRewards")} value={totalRewards} icon="🎁" />
			</div>

			{campaigns.length === 0 ? (
				<div className="admin-empty">{t("noCampaigns")}</div>
			) : (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{campaigns.map((c) => {
						const enabled = c.enabled === "1";
						const count = rewardCounts.get(c.id) ?? 0;
						return (
							<Link
								key={c.id}
								href={`/admin/calendar/${c.id}`}
								className="admin-card hover article"
							>
								{c.image ? (
									<img className="article-img" src={c.image} alt={c.name} />
								) : (
									<div className="article-img" />
								)}
								<div className="body">
									<div className="flex items-center justify-between gap-2 mb-1">
										<h3 className="m-0">{c.name || `#${c.id}`}</h3>
										<span
											className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-error-subtle)] text-[var(--admin-text)]"}`}
										>
											{enabled ? t("statusEnabled") : t("statusDisabled")}
										</span>
									</div>
									<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
										{t("campaignMeta", {
											id: c.id,
											days: c.totalDays,
											rewards: count,
										})}
									</p>
									<p className="text-xs theme-text-muted dark:theme-text-muted mt-1">
										{t("startsAt", {
											date: formatDate(
												new Date(c.startTimestamp * 1000),
												"date",
											),
										})}
										{c.lockExpired === "1" ? ` · ${t("locksExpired")}` : ""}
									</p>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</main>
	);
}
