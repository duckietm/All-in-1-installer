import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { claimReferral } from "@/actions/referral";
import Link from "@/components/link";
import {
	CurrencyIcon,
	type CurrencyKind,
} from "@/components/shared/currency-icon";
import { ProfileImage } from "@/components/shared/profile-image";
import { UserAvatarThumbnail } from "@/components/shared/user-avatar-thumbnail";
import { SurfaceCard } from "@/components/surface-card";
import { auth } from "@/lib/auth";
import { avatarImageUrl, badgeImageUrl, slugify } from "@/lib/format";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { loadDailyRewardState } from "@/lib/services/daily-rewards";
import { loadUserDashboard } from "@/lib/services/user-dashboard";
import CopyReferralButton from "./CopyReferralButton";
import DailyRewardCard from "./DailyRewardCard";
import DashboardTasks from "./DashboardTasks";
import styles from "./dashboard.module.css";

export async function generateMetadata() {
	const t = await getTranslations("pages.myDashboard");
	return { title: t("title") };
}

async function MePage({
	searchParams,
}: {
	searchParams: Promise<{
		claimed?: string;
		error?: string;
		daily?: string;
	}>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");
	const userId = Number(session.user.id);
	if (!Number.isFinite(userId) || userId <= 0) redirect("/login");
	const [t, format, { claimed, error, daily }] = await Promise.all([
		getTranslations("pages.myDashboard"),
		getFormatter(),
		searchParams,
	]);
	let data: Awaited<ReturnType<typeof loadUserDashboard>>;
	try {
		data = await loadUserDashboard(userId);
	} catch {
		return (
			<section>
				<SurfaceCard className="p-6">
					<p role="alert">{t("loadError")}</p>
					<Link href="/me" className="btn btn-outline">
						{t("retry")}
					</Link>
				</SurfaceCard>
			</section>
		);
	}
	// Daily reward state (settings + schedule + the user's last claim). Never
	// throws: on any DB hiccup it degrades to a disabled state.
	const dailyState = await loadDailyRewardState(userId);
	const user = data.userRows[0];
	if (!user)
		return (
			<section>
				<SurfaceCard className="p-6">
					<p role="alert">{t("loadError")}</p>
					<Link href="/login" className="btn btn-outline">
						{t("login")}
					</Link>
				</SurfaceCard>
			</section>
		);
	const {
		hotelName,
		neededRaw,
		rewardAmountRaw,
		currencySettings,
		alertRaw,
		recentRooms,
		badges,
		userSettingsRows,
		friendCountRows,
		unreadCountRows,
		referralsRows,
		friends,
		currencyRows,
		dashboardEvent,
	} = data;
	const userSettings = userSettingsRows[0];
	const friendCount = Number(friendCountRows[0]?.value ?? 0);
	const unreadCount = Number(unreadCountRows?.[0]?.value ?? 0);
	const needed = Math.max(1, Number.parseInt(neededRaw ?? "5", 10) || 5);
	const rewardAmount = Number.parseInt(rewardAmountRaw ?? "30", 10) || 0;
	const rewardCurrency = (
		currencySettings.referral_reward_currency_type ??
		currencySettings.referral_reward_currency ??
		"diamonds"
	)
		.trim()
		.toLowerCase();
	const rewardKind = ["credits", "duckets", "diamonds", "points"].includes(
		rewardCurrency,
	)
		? (rewardCurrency as CurrencyKind)
		: null;
	const referralTotal = Math.max(
		0,
		Number(referralsRows?.[0]?.referralsTotal ?? 0),
	);
	const canClaim =
		referralsRows !== null &&
		referralTotal >= needed &&
		rewardAmount > 0 &&
		rewardKind !== null;
	const remaining = Math.max(0, needed - referralTotal);
	const onlineFriends = friends.filter((friend) => friend.online === "1");
	const date = (value: number) =>
		value
			? format.dateTime(new Date(value * 1000), { dateStyle: "medium" })
			: t("never");
	const referralLink = `/register?ref=${encodeURIComponent(user.username)}`;
	const avatarFull = avatarImageUrl(user.look, { direction: 2 });
	const wallet = [
		{ kind: "credits", value: user.credits },
		{
			kind: "duckets",
			value:
				currencyRows === null
					? null
					: (currencyRows.find((row) => row.type === 0)?.amount ?? 0),
		},
		{
			kind: "diamonds",
			value:
				currencyRows === null
					? null
					: (currencyRows.find((row) => row.type === 5)?.amount ?? 0),
		},
	] as const;
	const errorKey =
		error &&
		["not_enough", "no_referrals", "bad_config", "ratelimit"].includes(error)
			? error
			: "error";
	return (
		<section className={styles.dashboard}>
			{claimed && (
				<p role="status" className={styles.feedback}>
					{t("claimed")}
				</p>
			)}
			{error && (
				<p role="alert" className={styles.feedback}>
					{t(`errors.${errorKey}`)}
				</p>
			)}
			{daily === "claimed" && (
				<p role="status" className={styles.feedback}>
					{t("dailyClaimed")}
				</p>
			)}
			{daily &&
				daily !== "claimed" &&
				[
					"already_claimed",
					"disabled",
					"bad_config",
					"ratelimit",
					"error",
				].includes(daily) && (
					<p role="alert" className={styles.feedback}>
						{t(`dailyErrors.${daily}`)}
					</p>
				)}
			<SurfaceCard className={styles.hero}>
				<ProfileImage
					src={avatarFull}
					alt={user.username}
					width={100}
					height={140}
					className={styles.avatar}
					loading="eager"
					fetchPriority="high"
				/>
				<div className={styles.identity}>
					<p className="muted">{t("welcome", { hotel: hotelName })}</p>
					<h1>{user.username}</h1>
					<p>{user.motto || t("noMotto")}</p>
					<p className={styles.dates}>
						{t("registered", { date: date(user.accountCreated) })} ·{" "}
						{t("lastOnline", { date: date(user.lastOnline) })}
					</p>
				</div>
				<Link href="/client" className="btn btn-primary">
					{t("enter", { hotel: hotelName })} →
				</Link>
			</SurfaceCard>
			<nav aria-label={t("quickLinks")} className={styles.shortcuts}>
				{[
					{ href: "/messages", label: t("messages"), count: unreadCount },
					{
						href: `/u/${encodeURIComponent(user.username)}`,
						label: t("profile"),
						count: 0,
					},
					{ href: "/settings", label: t("settings"), count: 0 },
					{ href: "/shop", label: t("shop"), count: 0 },
				].map((link) => (
					<Link key={link.href} href={link.href} className={styles.shortcut}>
						<span>
							{link.label}
							{link.href === "/messages" && (
								<span className={styles.shortcutHint}>
									{unreadCountRows === null
										? t("messagesUnavailable")
										: unreadCount > 0
											? t("unread", { count: unreadCount })
											: t("messagesCaughtUp")}
								</span>
							)}
						</span>
						{link.count > 0 && (
							<span className={styles.count} aria-hidden="true">
								{link.count > 99 ? "99+" : link.count}
							</span>
						)}
					</Link>
				))}
			</nav>
			{alertRaw && <p className={styles.feedback}>{alertRaw}</p>}
			<DashboardTasks
				userId={userId}
				rewardAvailable={referralsRows === null ? null : canClaim}
				dailyRewardAvailable={
					dailyState.enabled && !dailyState.alreadyClaimedToday
				}
			/>
			<section aria-label={t("wallet")} className={styles.wallet}>
				{wallet.map((currency) => (
					<SurfaceCard key={currency.kind} className={styles.currency}>
						<CurrencyIcon kind={currency.kind} size={28} alt="" />
						<div>
							<strong>
								{currency.value === null ? "—" : format.number(currency.value)}
							</strong>
							<span>{t(`currencies.${currency.kind}`)}</span>
						</div>
					</SurfaceCard>
				))}
			</section>
			<SurfaceCard
				title={t("eventTitle")}
				actionHref="/events"
				actionLabel={t("allEvents")}
				bodyClassName="p-5"
			>
				{dashboardEvent.unavailable ? (
					<p className="muted" role="status">
						{t("eventsUnavailable")}
					</p>
				) : dashboardEvent.event ? (
					<div className={styles.event}>
						<div className={styles.eventDetails}>
							<span className={styles.eventPhase}>
								{t(
									dashboardEvent.event.phase === "ongoing"
										? "eventOngoing"
										: "eventUpcoming",
								)}
							</span>
							<h2>{dashboardEvent.event.title}</h2>
							<p className="muted">
								{dashboardEvent.event.typeName} ·{" "}
								<time dateTime={dashboardEvent.event.startsAt.toISOString()}>
									{format.dateTime(dashboardEvent.event.startsAt, {
										dateStyle: "medium",
										timeStyle: "short",
									})}
								</time>
							</p>
						</div>
						<Link
							href={`/events/${slugify(dashboardEvent.event.title)}-${dashboardEvent.event.id}`}
							className="btn btn-outline"
						>
							{t("eventDetails")} →
						</Link>
					</div>
				) : (
					<p className="muted">{t("noUpcomingEvents")}</p>
				)}
			</SurfaceCard>
			<div className={styles.columns}>
				<div className={styles.stack}>
					<SurfaceCard
						title={t("onlineFriends")}
						actionHref="/friends"
						actionLabel={t("allFriends")}
						bodyClassName="p-5"
					>
						{data.friendsUnavailable ? (
							<p role="status" className="muted">
								{t("loadError")}
							</p>
						) : onlineFriends.length === 0 ? (
							<p className="muted">{t("noOnlineFriends")}</p>
						) : (
							<div className={styles.friends}>
								{onlineFriends.map((friend) => (
									<Link
										key={friend.id}
										href={`/u/${encodeURIComponent(friend.username)}`}
										className={styles.friend}
									>
										<UserAvatarThumbnail figure={friend.look} alt="" />
										<div>
											<strong>{friend.username}</strong>
											<span className="muted">
												{friend.motto || t("noMotto")}
											</span>
										</div>
									</Link>
								))}
							</div>
						)}
					</SurfaceCard>
					<SurfaceCard
						title={t("recentRooms")}
						actionHref="/community"
						actionLabel={t("community")}
						bodyClassName="p-5"
					>
						<p className="muted">{t("roomsHint")}</p>
						{recentRooms === null ? (
							<p className="muted" role="status">
								{t("roomsUnavailable")}
							</p>
						) : recentRooms.length === 0 ? (
							<p className="muted">{t("noRooms")}</p>
						) : (
							<div className={styles.rooms}>
								{recentRooms.map((room) => (
									<Link
										key={room.id}
										href={`/room/${room.id}`}
										className={styles.room}
									>
										<strong>{room.name}</strong>
										<span className="muted">
											{room.ownerName} · {room.users}/{room.usersMax}
										</span>
									</Link>
								))}
							</div>
						)}
					</SurfaceCard>
					<SurfaceCard title={t("activity")} bodyClassName="p-5">
						<dl className={styles.stats}>
							{[
								{
									label: t("achievements"),
									value: data.userSettingsUnavailable
										? "—"
										: format.number(userSettings?.achievementScore ?? 0),
								},
								{
									label: t("respects"),
									value: data.userSettingsUnavailable
										? "—"
										: format.number(userSettings?.respectsReceived ?? 0),
								},
								{
									label: t("friends"),
									value: data.friendsUnavailable
										? "—"
										: format.number(friendCount),
								},
								{ label: t("lastLogin"), value: date(user.lastLogin) },
							].map((stat) => (
								<div key={stat.label}>
									<dt className="muted">{stat.label}</dt>
									<dd>{stat.value}</dd>
								</div>
							))}
						</dl>
					</SurfaceCard>
				</div>
				<aside className={styles.stack}>
					<DailyRewardCard state={dailyState} />
					<SurfaceCard title={t("referrals")} bodyClassName="p-5">
						<div id="referral-reward" />
						<p>{t("referralHint")}</p>
						<div className={styles.progressLabel}>
							<strong>
								{referralTotal}/{needed}
							</strong>
							<span className="muted">{t("referralProgress")}</span>
						</div>
						<progress
							className={styles.progress}
							value={Math.min(referralTotal, needed)}
							max={needed}
							aria-label={t("referralProgress")}
						/>
						<p className={styles.reward}>
							{rewardKind && (
								<CurrencyIcon kind={rewardKind} size={20} alt="" />
							)}
							{rewardAmount > 0
								? t("reward", {
										amount: format.number(rewardAmount),
										currency: t.has(`currencies.${rewardCurrency}`)
											? t(`currencies.${rewardCurrency}`)
											: rewardCurrency,
										count: needed,
									})
								: t("rewardHint", { count: needed })}
						</p>
						<label htmlFor="referral-link">{t("referralLink")}</label>
						<input
							id="referral-link"
							value={referralLink}
							readOnly
							className={styles.referralInput}
						/>
						<CopyReferralButton value={referralLink} />
						{referralsRows === null ? (
							<p role="status" className="muted">
								{t("tasks.rewardUnavailable")}
							</p>
						) : canClaim ? (
							<form action={claimReferral} className={styles.claim}>
								<button type="submit" className="btn btn-primary">
									{t("claim")}
								</button>
							</form>
						) : (
							<p className="muted" role="status">
								{t("remaining", { count: remaining })}
							</p>
						)}
						<details className={styles.rules}>
							<summary>{t("rules")}</summary>
							<p>{t("rulesText")}</p>
						</details>
					</SurfaceCard>
					<SurfaceCard title={t("badges")} bodyClassName="p-5">
						{data.badgesUnavailable ? (
							<p role="status" className="muted">
								{t("loadError")}
							</p>
						) : badges.length === 0 ? (
							<p className="muted">{t("noBadges")}</p>
						) : (
							<div className={styles.badges}>
								{badges.map((badge) => (
									<img
										key={badge.badgeCode}
										src={badgeImageUrl(badge.badgeCode)}
										alt={badge.badgeCode}
										title={badge.badgeCode}
										width={40}
										height={40}
										loading="lazy"
									/>
								))}
							</div>
						)}
					</SurfaceCard>
				</aside>
			</div>
		</section>
	);
}

export default withPublicPagePerformance("/me", MePage);
