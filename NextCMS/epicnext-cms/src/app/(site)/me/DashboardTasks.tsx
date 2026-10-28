import { getFormatter, getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { SurfaceCard } from "@/components/surface-card";
import { slugify } from "@/lib/format";
import { loadDashboardTasks } from "@/lib/services/dashboard-tasks";
import styles from "./dashboard.module.css";

export default async function DashboardTasks({
	userId,
	rewardAvailable,
	dailyRewardAvailable,
}: {
	userId: number;
	rewardAvailable: boolean | null;
	/** Claimable daily login reward (false when claimed/disabled or loader down). */
	dailyRewardAvailable?: boolean;
}) {
	const [data, t, format] = await Promise.all([
		loadDashboardTasks(userId),
		getTranslations("pages.myDashboard.tasks"),
		getFormatter(),
	]);
	const items: { href: string; label: string }[] = [];
	if (data.support)
		items.push({
			href: "/help/tickets",
			label: t("support", { count: data.support }),
		});
	if (data.friendRequests)
		items.push({
			href: "/friends",
			label: t("friends", { count: data.friendRequests }),
		});
	if (data.registeredEvent)
		items.push({
			href: `/events/${slugify(data.registeredEvent.title)}-${data.registeredEvent.id}`,
			label: t("event", {
				title: data.registeredEvent.title,
				date: format.dateTime(data.registeredEvent.startsAt, {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			}),
		});
	if (rewardAvailable)
		items.push({ href: "#referral-reward", label: t("reward") });
	if (dailyRewardAvailable)
		items.push({ href: "#daily-reward", label: t("dailyReward") });
	const unavailable =
		data.support === null ||
		data.friendRequests === null ||
		data.registeredEvent === null ||
		rewardAvailable === null;
	return (
		<SurfaceCard title={t("title")} bodyClassName="p-5">
			{items.length > 0 ? (
				<ul className={styles.tasks}>
					{items.map((item) => (
						<li key={item.href}>
							<Link href={item.href}>
								{item.label}
								<span aria-hidden="true"> →</span>
							</Link>
						</li>
					))}
				</ul>
			) : !unavailable ? (
				<p className="muted">{t("empty")}</p>
			) : null}
			{unavailable && (
				<p role="status" className="muted">
					{t("unavailable")} <Link href="/me">{t("retry")}</Link>
				</p>
			)}
		</SurfaceCard>
	);
}
