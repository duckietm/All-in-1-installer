import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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

type Reward = {
	id: number;
	campaignId: number;
	productName: string;
	customImage: string;
	credits: number;
	pixels: number;
	points: number;
	pointsType: number;
	badge: string;
	itemId: number;
	subscriptionType: string | null;
	subscriptionDays: number;
};

export default async function AdminCalendarCampaign({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.calendar");

	const { id } = await params;
	const campaignId = Number(id);
	if (!Number.isInteger(campaignId)) notFound();

	let campaign: Campaign | null = null;
	try {
		const [row] = await db
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
			.where(eq(CalendarCampaigns.id, campaignId))
			.limit(1);
		campaign = row ?? null;
	} catch {
		campaign = null;
	}
	if (!campaign) notFound();

	let rewards: Reward[] = [];
	try {
		rewards = await db
			.select({
				id: CalendarRewards.id,
				campaignId: CalendarRewards.campaignId,
				productName: CalendarRewards.productName,
				customImage: CalendarRewards.customImage,
				credits: CalendarRewards.credits,
				pixels: CalendarRewards.pixels,
				points: CalendarRewards.points,
				pointsType: CalendarRewards.pointsType,
				badge: CalendarRewards.badge,
				itemId: CalendarRewards.itemId,
				subscriptionType: CalendarRewards.subscriptionType,
				subscriptionDays: CalendarRewards.subscriptionDays,
			})
			.from(CalendarRewards)
			.where(eq(CalendarRewards.campaignId, campaignId))
			.orderBy(asc(CalendarRewards.id))
			.limit(500);
	} catch {
		rewards = [];
	}

	const disabled = campaign.enabled !== "1";

	return (
		<main>
			<p className="text-xs theme-text-muted dark:theme-text-muted mb-4">
				<Link href="/admin/calendar">← {t("title")}</Link>
			</p>

			<div className="admin-card flex items-center gap-5 mb-6">
				{campaign.image ? (
					<img
						className="w-24 h-24 object-cover"
						src={campaign.image}
						alt={campaign.name}
					/>
				) : null}
				<div>
					<h1 className="m-0 mb-1">{campaign.name || `#${campaign.id}`}</h1>
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("detail.campaignMeta", {
							id: campaign.id,
							days: campaign.totalDays,
							date: formatDate(
								new Date(campaign.startTimestamp * 1000),
								"date",
							),
						})}
						{disabled
							? ` · ${t("detail.disabled")}`
							: ` · ${t("detail.enabled")}`}
						{campaign.lockExpired === "1"
							? ` · ${t("detail.locksExpired")}`
							: ""}
					</p>
				</div>
			</div>

			<h2 className="admin-section-title">{t("detail.rewards")}</h2>
			{rewards.length === 0 ? (
				<div className="admin-empty">{t("detail.noRewards")}</div>
			) : (
				<table className="w-full">
					<thead>
						<tr className="text-left text-[var(--muted)]">
							<th>{t("detail.colId")}</th>
							<th>{t("detail.colProduct")}</th>
							<th>{t("detail.colItem")}</th>
							<th>{t("detail.colCredits")}</th>
							<th>{t("detail.colPixels")}</th>
							<th>{t("detail.colPoints")}</th>
							<th>{t("detail.colBadge")}</th>
							<th>{t("detail.colSubscription")}</th>
						</tr>
					</thead>
					<tbody>
						{rewards.map((r) => (
							<tr key={r.id} className="border-t border-[var(--admin-border)]">
								<td>{r.id}</td>
								<td>
									{r.productName || (
										<span className="text-sm theme-text-muted dark:theme-text-muted">
											—
										</span>
									)}
								</td>
								<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
									{r.itemId > 0 ? r.itemId : "—"}
								</td>
								<td>
									{r.credits > 0 ? (
										r.credits
									) : (
										<span className="text-sm theme-text-muted dark:theme-text-muted">
											—
										</span>
									)}
								</td>
								<td>
									{r.pixels > 0 ? (
										r.pixels
									) : (
										<span className="text-sm theme-text-muted dark:theme-text-muted">
											—
										</span>
									)}
								</td>
								<td>
									{r.points > 0 ? (
										`${r.points} (${t("detail.typeLabel", { type: r.pointsType })})`
									) : (
										<span className="text-sm theme-text-muted dark:theme-text-muted">
											—
										</span>
									)}
								</td>
								<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
									{r.badge || "—"}
								</td>
								<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
									{r.subscriptionType
										? `${r.subscriptionType} · ${r.subscriptionDays}d`
										: "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<p className="text-xs theme-text-muted dark:theme-text-muted mt-4">
				{t("detail.rewardCount", { count: rewards.length })}
			</p>
		</main>
	);
}
