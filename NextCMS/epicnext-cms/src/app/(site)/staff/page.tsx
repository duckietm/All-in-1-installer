import { asc, desc, eq, gte } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import { ProfileImage } from "@/components/shared/profile-image";
import { SurfaceCard } from "@/components/surface-card";
import { db, User, WebsiteTeams } from "@/lib/db";
import { avatarImageUrl } from "@/lib/format";
import { publicReadFailure } from "@/lib/services/public-read";
import { siteSettings } from "@/lib/services/site-settings";
import styles from "./staff.module.css";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.staff");
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

export default async function StaffPage() {
	const t = await getTranslations("pages.staff");
	const minStaffRank =
		Number(await siteSettings.get("min_staff_rank", "7")) || 7;

	// Independent queries — staff members and teams load concurrently.
	const [staff, teams] = await Promise.all([
		db
			.select({
				username: User.username,
				look: User.look,
				rank: User.rank,
				motto: User.motto,
			})
			.from(User)
			.where(gte(User.rank, minStaffRank))
			.orderBy(desc(User.rank), asc(User.username))
			.limit(100)
			.catch(publicReadFailure("staff.members")),
		db
			.select({
				id: WebsiteTeams.id,
				rankName: WebsiteTeams.rankName,
				badge: WebsiteTeams.badge,
				jobDescription: WebsiteTeams.jobDescription,
				staffColor: WebsiteTeams.staffColor,
			})
			.from(WebsiteTeams)
			.where(eq(WebsiteTeams.hiddenRank, false))
			.orderBy(asc(WebsiteTeams.id))
			.then((rows) => rows.map((row) => ({ ...row, id: String(row.id) })))
			.catch(publicReadFailure("staff.teams")),
	]);

	return (
		<section className={styles.page}>
			<SurfaceCard className={styles.hero}>
				<div>
					<h1>{t("title")}</h1>
					<p>{t("subtitle")}</p>
				</div>
				{staff && staff.length > 0 && (
					<span className={styles.count}>
						{t("membersSubtitle", { count: staff.length })}
					</span>
				)}
			</SurfaceCard>
			<section aria-labelledby="staff-members">
				<h2 id="staff-members" className={styles.heading}>
					{t("membersTitle")}
				</h2>
				{staff === null ? (
					<SurfaceCard className={styles.notice}>
						<p role="alert">{t("loadError")}</p>
						<Link href="/staff" className="btn btn-outline">
							{t("retry")}
						</Link>
					</SurfaceCard>
				) : staff.length === 0 ? (
					<SurfaceCard className={styles.notice}>
						<p>{t("emptyState")}</p>
					</SurfaceCard>
				) : (
					<ul className={styles.grid}>
						{staff.map((member) => (
							<li key={member.username}>
								<Link
									href={`/u/${encodeURIComponent(member.username)}`}
									className={styles.member}
								>
									<ProfileImage
										src={avatarImageUrl(member.look, {
											size: "m",
											direction: 2,
											headDirection: 3,
										})}
										alt={member.username}
										width={64}
										height={110}
										className={styles.avatar}
									/>
									<div className={styles.identity}>
										<h3>{member.username}</h3>
										<p>{member.motto || t("noMotto")}</p>
										<span className={styles.profile}>
											{t("viewProfile")} <span aria-hidden="true">→</span>
										</span>
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
			{teams === null ? (
				<SurfaceCard className={styles.notice}>
					<PublicLoadError href="/staff" />
				</SurfaceCard>
			) : (
				teams.length > 0 && (
					<section aria-labelledby="staff-teams">
						<h2 id="staff-teams" className={styles.heading}>
							{t("ranksTitle")}
						</h2>
						<p className={styles.subtitle}>{t("ranksSubtitle")}</p>
						<ul className={styles.grid}>
							{teams.map((team) => (
								<li key={team.id}>
									<SurfaceCard className={styles.team}>
										<span
											className={styles.accent}
											style={{
												backgroundColor: /^#[0-9a-f]{6}$/i.test(team.staffColor)
													? team.staffColor
													: "var(--color-primary)",
											}}
											aria-hidden="true"
										/>
										<h3>{team.rankName}</h3>
										{team.jobDescription && <p>{team.jobDescription}</p>}
									</SurfaceCard>
								</li>
							))}
						</ul>
					</section>
				)
			)}
		</section>
	);
}
