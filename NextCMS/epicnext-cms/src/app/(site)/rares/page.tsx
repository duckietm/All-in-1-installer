import { asc, count } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.rares");
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

type CategoryRow = {
	id: bigint;
	name: string;
	badge: string;
	priority: number;
};

export default async function RareValuesPage() {
	const t = await getTranslations("pages.rares");

	// Categories, per-category rare counts and site settings are all
	// independent — run them concurrently instead of sequentially.
	const [categoryRows, grouped, badgesBase] = await Promise.all([
		db
			.select({
				id: WebsiteRareValueCategories.id,
				name: WebsiteRareValueCategories.name,
				badge: WebsiteRareValueCategories.badge,
				priority: WebsiteRareValueCategories.priority,
			})
			.from(WebsiteRareValueCategories)
			.orderBy(
				asc(WebsiteRareValueCategories.priority),
				asc(WebsiteRareValueCategories.name),
			)
			.catch((): CategoryRow[] => []),
		db
			.select({
				categoryId: WebsiteRareValues.categoryId,
				value: count(),
			})
			.from(WebsiteRareValues)
			.groupBy(WebsiteRareValues.categoryId)
			.catch(() => []),
		siteSettings.get("badges_path", ""),
	]);

	const categories = categoryRows;

	// Per-category rare counts (grouped so we avoid N queries).
	const counts = new Map<string, number>();
	for (const g of grouped) {
		counts.set(String(g.categoryId), Number(g.value));
	}

	return (
		<section className="page-grid">
			<ContentCard icon="💎" title={t("title")} subtitle={t("subtitle")} />

			{categories.length === 0 ? (
				<ContentCard padded={false}>
					<EmptyState icon="💎">{t("empty")}</EmptyState>
				</ContentCard>
			) : (
				<div className="card-grid sm-2 lg-3">
					{categories.map((c) => {
						const id = String(c.id);
						const rareCount = counts.get(id) ?? 0;
						const badgeSrc =
							badgesBase && c.badge ? `${badgesBase}/${c.badge}.gif` : "";
						return (
							<Link
								key={id}
								href={`/rares/${id}`}
								className="content-card hover-lift"
								style={{ color: "inherit", textDecoration: "none" }}
							>
								<div className="content-card-head">
									{badgeSrc ? (
										<img
											src={badgeSrc}
											alt={`${c.name} badge`}
											width={36}
											height={36}
											style={{ flexShrink: 0 }}
										/>
									) : (
										<span className="content-card-icon" aria-hidden>
											💎
										</span>
									)}
									<div className="content-card-head-text">
										<p className="content-card-title">{c.name}</p>
										<p className="content-card-subtitle">
											{t("rareCount", { count: rareCount })}
										</p>
									</div>
								</div>
								<div className="content-card-body">
									<span className="btn btn-outline">{t("viewRares")}</span>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</section>
	);
}
