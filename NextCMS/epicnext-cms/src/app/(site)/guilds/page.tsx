import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { PublicLoadError } from "@/components/public/load-error";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, Guilds } from "@/lib/db";
import { excerpt } from "@/lib/format";
import { publicReadFailure } from "@/lib/services/public-read";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.guilds");
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

type GuildCard = {
	id: number;
	name: string;
	description: string;
	badge: string;
};

async function getGuilds(): Promise<GuildCard[] | null> {
	try {
		return await db
			.select({
				id: Guilds.id,
				name: Guilds.name,
				description: Guilds.description,
				badge: Guilds.badge,
			})
			.from(Guilds)
			.orderBy(desc(Guilds.id))
			.limit(40);
	} catch (error) {
		return publicReadFailure("guilds")(error);
	}
}

export default async function GuildsPage() {
	const t = await getTranslations("pages.guilds");
	const guilds = await getGuilds();

	return (
		<section className="page-grid">
			<ContentCard icon="🚪" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={!guilds?.length}>
				{guilds === null ? (
					<PublicLoadError href="/guilds" />
				) : guilds.length === 0 ? (
					<EmptyState icon="🚪">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{guilds.map((g) => (
							<Link
								key={g.id}
								href={`/guilds/${g.id}`}
								className="card hover"
								style={{
									display: "flex",
									gap: "0.85rem",
									alignItems: "flex-start",
									color: "inherit",
									textDecoration: "none",
								}}
							>
								{g.badge ? (
									<img
										src={`https://habbo-stories-content.s3.amazonaws.com/badge-part-images/${g.badge}.gif`}
										alt={`${g.name} badge`}
										width={40}
										height={40}
										style={{ flex: "0 0 auto" }}
									/>
								) : null}
								<div style={{ minWidth: 0 }}>
									<h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
										{g.name || t("unnamedGuild")}
									</h3>
									<p className="muted" style={{ margin: 0 }}>
										{g.description
											? excerpt(g.description, 120)
											: t("noDescription")}
									</p>
								</div>
							</Link>
						))}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
