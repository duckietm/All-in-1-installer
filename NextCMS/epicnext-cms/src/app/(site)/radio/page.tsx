import { asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.radio");
	return {
		title: t("title"),
		description: t("subtitle"),
		openGraph: {
			title: t("title"),
			description: t("subtitle"),
			type: "website",
		},
	};
}

import { ContentCard, EmptyState, OnlineBadge } from "@/components/public/ui";
import { db, RadioSchedules, User } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";

// Radio config + today's schedule are read live from the DB / settings table.

// Canonical weekday order so today's slots come out chronologically and we can
// match the current day against whatever casing the `day` column stores.
const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

// radio_schedules.start_time / end_time are stored as TIME and surface through
// as a Date with the time component on a 1970 epoch date — render just
// the HH:MM portion in UTC to avoid timezone drift.
function formatTime(d: Date | null | undefined): string {
	if (!d) return "";
	return d.toISOString().slice(11, 16);
}

export default async function RadioPage() {
	const t = await getTranslations("pages.radio");

	// Sub-pages linked from the radio home hub.
	const RADIO_LINKS: {
		label: string;
		href: string;
		icon: string;
		text: string;
	}[] = [
		{
			label: t("linkSchedule"),
			href: "/radio/schedule",
			icon: "🗓️",
			text: t("linkScheduleText"),
		},
		{
			label: t("linkShouts"),
			href: "/radio/shouts",
			icon: "📣",
			text: t("linkShoutsText"),
		},
		{
			label: t("linkRequests"),
			href: "/radio/requests",
			icon: "🎵",
			text: t("linkRequestsText"),
		},
		{
			label: t("linkApply"),
			href: "/radio/apply",
			icon: "🎤",
			text: t("linkApplyText"),
		},
		{
			label: t("linkLeaderboard"),
			href: "/radio/leaderboard",
			icon: "🏆",
			text: t("linkLeaderboardText"),
		},
	];

	// ── Radio config from website_settings (graceful fallbacks) ──
	const [streamUrl, currentDj, currentSong] = await Promise.all([
		siteSettings.get("radio_stream_url", ""),
		siteSettings.get("radio_current_dj", ""),
		siteSettings.get("radio_current_song", ""),
	]);

	// ── Today's schedule (isolated; a DB hiccup degrades to empty) ──
	const today = WEEKDAYS[new Date().getUTCDay()] ?? "";
	const schedules = await db
		.select()
		.from(RadioSchedules)
		.where(eq(RadioSchedules.isActive, true))
		.orderBy(asc(RadioSchedules.startTime))
		.catch(() => []);

	const todaysSlots = schedules.filter(
		(s) => s.day.toLowerCase() === today.toLowerCase(),
	);

	// Resolve DJ usernames for today's slots in one query. radio_schedules.user_id
	// is an UnsignedBigInt while users.id is an Int, so narrow to Number for the
	// lookup (DJ ids comfortably fit in a JS-safe integer).
	const djIds = Array.from(new Set(todaysSlots.map((s) => Number(s.userId))));
	const djs = djIds.length
		? await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, djIds))
				.catch(() => [])
		: [];
	const djById = new Map(djs.map((d) => [d.id, d.username]));

	const isLive = Boolean(streamUrl);

	return (
		<section className="page-grid">
			{/* ── Header: live stream + now playing ─────────────────────── */}
			<ContentCard
				icon="📻"
				title={t("title")}
				subtitle={t("subtitle")}
				action={<OnlineBadge online={isLive} />}
			>
				<div className="card-grid sm-2" style={{ alignItems: "stretch" }}>
					<div
						className="card"
						style={{ display: "grid", gap: "0.35rem", alignContent: "center" }}
					>
						<p
							className="muted"
							style={{
								margin: 0,
								fontSize: "0.8rem",
								textTransform: "uppercase",
								letterSpacing: "0.05em",
							}}
						>
							{t("nowPlaying")}
						</p>
						<p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
							{currentSong ? (
								currentSong
							) : (
								<span className="muted" style={{ fontWeight: 400 }}>
									{t("nothingPlaying")}
								</span>
							)}
						</p>
						<p className="muted" style={{ margin: 0 }}>
							{currentDj ? t("onAir", { dj: currentDj }) : t("noDj")}
						</p>
					</div>
					<div
						className="card"
						style={{ display: "flex", alignItems: "center" }}
					>
						{streamUrl ? (
							<audio
								controls
								src={streamUrl}
								style={{ width: "100%" }}
								preload="none"
							>
								<track kind="captions" />
								{t("audioUnsupported")}
							</audio>
						) : (
							<p className="muted" style={{ margin: 0 }}>
								{t("streamOffline")}
							</p>
						)}
					</div>
				</div>
			</ContentCard>

			{/* ── Sub-page links ──────────────────────────────────────── */}
			<ContentCard
				icon="🎚️"
				title={t("exploreTitle")}
				subtitle={t("exploreSubtitle")}
			>
				<div className="card-grid sm-2 lg-3">
					{RADIO_LINKS.map((l) => (
						<Link
							key={l.href}
							href={l.href}
							className="card hover"
							style={{
								color: "inherit",
								textDecoration: "none",
								display: "grid",
								gap: "0.4rem",
							}}
						>
							<p style={{ margin: 0, fontWeight: 700 }}>
								<span aria-hidden>{l.icon}</span> {l.label}
							</p>
							<p className="muted" style={{ margin: 0 }}>
								{l.text}
							</p>
						</Link>
					))}
				</div>
			</ContentCard>

			{/* ── Today's schedule ────────────────────────────────────── */}
			<ContentCard
				icon="🗓️"
				title={today ? t("todayTitleWithDay", { day: today }) : t("todayTitle")}
				subtitle={t("todaySubtitle")}
				action={
					<Link className="btn btn-outline" href="/radio/schedule">
						{t("fullWeek")}
					</Link>
				}
				padded={todaysSlots.length === 0}
			>
				{todaysSlots.length === 0 ? (
					<EmptyState icon="📻">{t("noShowsToday")}</EmptyState>
				) : (
					<table>
						<thead>
							<tr>
								<th>{t("colTime")}</th>
								<th>{t("colShow")}</th>
								<th>{t("colDj")}</th>
							</tr>
						</thead>
						<tbody>
							{todaysSlots.map((s) => {
								const djName = djById.get(Number(s.userId));
								return (
									<tr key={String(s.id)}>
										<td>
											{formatTime(s.startTime)} &ndash; {formatTime(s.endTime)}
										</td>
										<td>
											{s.showName || (
												<span className="muted">{t("untitledShow")}</span>
											)}
										</td>
										<td>
											{djName ? (
												<Link href={`/u/${djName}`}>{djName}</Link>
											) : (
												<span className="muted">
													{t("userNumber", { id: String(s.userId) })}
												</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</ContentCard>
		</section>
	);
}
