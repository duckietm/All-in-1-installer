import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, WebsiteBadges } from "@/lib/db";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.badges");
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

// A badge_key (e.g. "ADM") maps to a .gif served through the cached proxy.
const BADGE_IMG_BASE = "/api/imaging/badge?code";

export default async function BadgesPage() {
	const t = await getTranslations("pages.badges");

	const badges = await db
		.select()
		.from(WebsiteBadges)
		.orderBy(asc(WebsiteBadges.badgeName))
		.catch(() => []);

	return (
		<section className="page-grid">
			<ContentCard icon="🏅" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={badges.length === 0}>
				{badges.length === 0 ? (
					<EmptyState icon="🏅">{t("noBadges")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{badges.map((badge) => (
							<div
								key={String(badge.id)}
								className="card hover"
								style={{
									display: "flex",
									gap: "0.9rem",
									alignItems: "flex-start",
								}}
							>
								<img
									src={`${BADGE_IMG_BASE}=${encodeURIComponent(badge.badgeKey)}`}
									alt={badge.badgeName}
									title={badge.badgeKey}
									width={40}
									height={40}
									style={{ flexShrink: 0 }}
								/>
								<div style={{ minWidth: 0 }}>
									<h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
										{badge.badgeName}
									</h3>
									<p
										className="muted"
										style={{ margin: "0 0 0.35rem", fontFamily: "monospace" }}
									>
										{badge.badgeKey}
									</p>
									<p style={{ margin: 0, fontSize: "0.9rem" }}>
										{badge.badgeDescription}
									</p>
								</div>
							</div>
						))}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
