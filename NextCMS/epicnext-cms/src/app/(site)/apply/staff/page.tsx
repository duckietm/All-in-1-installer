import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { applyStaff } from "@/actions/applications";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import {
	db,
	WebsiteOpenPositions,
	WebsiteStaffApplications,
	WebsiteTeams,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { resolveHotelName } from "@/lib/hotel-name";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.applyStaff");
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

export default async function ApplyStaffPage({
	searchParams,
}: {
	searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.applyStaff");
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

	// ── Open positions ──────────────────────────────────────────
	// Each query is isolated so a DB hiccup degrades that section to empty
	// rather than 500-ing the whole page.
	const positions = await db
		.select()
		.from(WebsiteOpenPositions)
		.orderBy(desc(WebsiteOpenPositions.createdAt))
		.catch(() => []);

	// Resolve display info for each position's rank. The rich rank fields
	// (rankName/badge/jobDescription/staffColor) live in website_teams, keyed by
	// the same rank id the position's permission_id points at.
	const rankIds = Array.from(new Set(positions.map((p) => p.permissionId)));
	const teams = rankIds.length
		? await db
				.select()
				.from(WebsiteTeams)
				.where(
					inArray(
						WebsiteTeams.id,
						rankIds.map((r) => BigInt(r)),
					),
				)
				.catch(() => [])
		: [];
	const teamByRankId = new Map(teams.map((team) => [Number(team.id), team]));

	// Ranks this user has already applied for (block re-applying).
	const myApps = await db
		.select({ rankId: WebsiteStaffApplications.rankId })
		.from(WebsiteStaffApplications)
		.where(eq(WebsiteStaffApplications.userId, userId))
		.catch(() => []);
	const appliedRankIds = new Set(myApps.map((a) => a.rankId));

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
				icon="🛡️"
				title={t("title", { hotel: hotelName })}
				subtitle={t("subtitle")}
			/>

			{positions.length === 0 ? (
				<ContentCard icon="🛡️" title={t("noPositionsTitle")}>
					<EmptyState icon="🛡️">{t("noPositionsBody")}</EmptyState>
				</ContentCard>
			) : (
				<div className="card-grid sm-2">
					{positions.map((position) => {
						const team = teamByRankId.get(position.permissionId);
						const rankName = team?.rankName ?? `Rank #${position.permissionId}`;
						const alreadyApplied = appliedRankIds.has(position.permissionId);
						return (
							<article key={String(position.id)} className="content-card">
								<div className="content-card-head">
									{team?.badge ? (
										<img
											src={`${BADGE_IMG_BASE}=${encodeURIComponent(team.badge)}`}
											alt={rankName}
											width={40}
											height={40}
										/>
									) : (
										<span className="content-card-icon" aria-hidden>
											🛡️
										</span>
									)}
									<div className="content-card-head-text">
										<p
											className="content-card-title"
											style={{ color: team?.staffColor || undefined }}
										>
											{rankName}
										</p>
										{team?.jobDescription ? (
											<p className="content-card-subtitle">
												{team.jobDescription}
											</p>
										) : null}
									</div>
								</div>

								<div className="content-card-body">
									<p style={{ margin: "0 0 0.5rem" }}>{position.description}</p>
									<p className="muted" style={{ margin: "0 0 0.75rem" }}>
										{t("deadline", {
											date: formatDate(
												position.applyTo,
												"datetime",
												t("noDeadline"),
											),
										})}
									</p>

									{alreadyApplied ? (
										<button
											type="button"
											className="btn btn-danger"
											disabled
											style={{ width: "100%" }}
										>
											{t("alreadyApplied", { rank: rankName })}
										</button>
									) : (
										<form action={applyStaff}>
											{/* rank_id is the position's permission id; the applicant is
                          re-read from the session inside the action. */}
											<input
												type="hidden"
												name="rankId"
												value={String(position.permissionId)}
											/>
											<label
												htmlFor={`content-${position.id}`}
												className="muted"
											>
												{t("aboutYou")}
											</label>
											<textarea
												id={`content-${position.id}`}
												name="content"
												required
												minLength={10}
												rows={5}
												placeholder={t("aboutPlaceholder", { rank: rankName })}
												style={{
													width: "100%",
													margin: "0.4rem 0 0.75rem",
													resize: "vertical",
												}}
											/>
											<button
												type="submit"
												className="btn btn-secondary"
												style={{ width: "100%" }}
											>
												{t("applyFor", { rank: rankName })}
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
