import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { applyTeam } from "@/actions/applications";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import { db, WebsiteStaffApplications, WebsiteTeams } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.applyTeam");
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

// Badge codes map to a .gif served through the cached proxy.
const BADGE_IMG_BASE = "/cms_api/imaging/badge?code";

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export default async function ApplyTeamPage({
	searchParams,
}: {
	searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.applyTeam");
	const { submitted, error } = await searchParams;

	const errorMessage =
		error === "empty"
			? t("errors.empty")
			: error === "duplicate"
				? t("errors.duplicate")
				: error === "ratelimit"
					? t("errors.ratelimit")
					: error === "invalid"
						? t("errors.invalid")
						: error
							? t("errors.error")
							: null;

	const userId = Number(session.user.id);
	const hotelName = await resolveHotelName();

	// ── Teams open for application ──────────────────────────────
	// Teams are exposed directly (no separate team-position table
	// with position_kind), so the team application concept lists website_teams.
	// Hidden ranks are excluded from the public apply page.
	const teams = await db
		.select()
		.from(WebsiteTeams)
		.where(eq(WebsiteTeams.hiddenRank, false))
		.orderBy(asc(WebsiteTeams.rankName))
		.catch(() => []);

	// Teams this user has already applied to. Team applications reuse the staff
	// applications table with rank_id carrying the team id (the team flag).
	const myApps = await db
		.select({ rankId: WebsiteStaffApplications.rankId })
		.from(WebsiteStaffApplications)
		.where(eq(WebsiteStaffApplications.userId, userId))
		.catch(() => []);
	const appliedTeamIds = new Set(myApps.map((a) => a.rankId));

	return (
		<section className="page-grid">
			{submitted === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.submitted")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard
				icon="🤝"
				title={t("title", { hotel: hotelName })}
				subtitle={t("subtitle")}
			/>

			{teams.length === 0 ? (
				<ContentCard icon="🤝" title={t("noPositionsTitle")}>
					<EmptyState icon="🤝">{t("noPositionsBody")}</EmptyState>
				</ContentCard>
			) : (
				<div className="card-grid sm-2">
					{teams.map((team) => {
						const teamId = Number(team.id);
						const alreadyApplied = appliedTeamIds.has(teamId);
						return (
							<article key={String(team.id)} className="content-card">
								<div className="content-card-head">
									{team.badge ? (
										<img
											src={`${BADGE_IMG_BASE}=${encodeURIComponent(team.badge)}`}
											alt={team.rankName}
											width={40}
											height={40}
										/>
									) : (
										<span className="content-card-icon" aria-hidden>
											🤝
										</span>
									)}
									<div className="content-card-head-text">
										<p
											className="content-card-title"
											style={{ color: team.staffColor || undefined }}
										>
											{team.rankName}
										</p>
										{team.jobDescription ? (
											<p className="content-card-subtitle">
												{team.jobDescription}
											</p>
										) : null}
									</div>
								</div>

								<div className="content-card-body">
									{alreadyApplied ? (
										<button
											type="button"
											className="btn btn-danger"
											disabled
											style={{ width: "100%" }}
										>
											{t("pending")}
										</button>
									) : (
										<form action={applyTeam}>
											{/* The team id is the application's rank flag; the applicant
                          is re-read from the session inside the action. */}
											<input
												type="hidden"
												name="teamId"
												value={String(team.id)}
											/>
											<label htmlFor={`content-${team.id}`} className="muted">
												{t("aboutYou")}
											</label>
											<textarea
												id={`content-${team.id}`}
												name="content"
												required
												minLength={10}
												rows={5}
												placeholder={t("aboutPlaceholder", {
													rank: team.rankName,
												})}
												style={{
													width: "100%",
													margin: "0.4rem 0 0.75rem",
													resize: "vertical",
												}}
											/>
											<button
												type="submit"
												className="btn btn-primary"
												style={{ width: "100%" }}
											>
												{t("applyFor", { rank: team.rankName })}
											</button>
										</form>
									)}
								</div>
							</article>
						);
					})}
				</div>
			)}
		</section>
	);
}
