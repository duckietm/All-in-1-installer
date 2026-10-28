import { desc } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { db, Guilds, WebsiteArticles } from "@/lib/db";

// Installation metadata must be resolved from the running container.
export const dynamic = "force-dynamic";

// Built at request time — avoids competing with SSG workers for scarce DB
// connections during `next build` (pool timeouts killed deploy on sitemap).

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const appUrl = process.env.APP_URL ?? "http://localhost:3000";

	// Static pages
	const staticPages = [
		{
			url: appUrl,
			lastModified: new Date(),
			changeFrequency: "hourly" as const,
			priority: 1,
		},
		{
			url: `${appUrl}/news`,
			lastModified: new Date(),
			changeFrequency: "hourly" as const,
			priority: 0.9,
		},
		{
			url: `${appUrl}/community`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.7,
		},
		{
			url: `${appUrl}/shop`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.8,
		},
		{
			url: `${appUrl}/leaderboard`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.6,
		},
		{
			url: `${appUrl}/rankings`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.6,
		},
		{
			url: `${appUrl}/staff`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.5,
		},
		{
			url: `${appUrl}/help`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.5,
		},
		{
			url: `${appUrl}/badges`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.4,
		},
		{
			url: `${appUrl}/radio`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.7,
		},
	];

	// News articles
	let articles: { slug: string; updatedAt: Date | null }[] = [];
	try {
		articles = await db
			.select({
				slug: WebsiteArticles.slug,
				updatedAt: WebsiteArticles.updatedAt,
			})
			.from(WebsiteArticles)
			.orderBy(desc(WebsiteArticles.createdAt))
			.limit(200);
	} catch {
		/* empty */
	}

	const articlePages = articles.map((a) => ({
		url: `${appUrl}/news/${a.slug}`,
		lastModified: a.updatedAt ?? new Date(),
		changeFrequency: "monthly" as const,
		priority: 0.6,
	}));

	// Guilds
	let guildIds: number[] = [];
	try {
		const rows = await db.select({ id: Guilds.id }).from(Guilds).limit(200);
		guildIds = rows.map((r) => Number(r.id));
	} catch {
		/* empty */
	}

	const guildPages = guildIds.map((id) => ({
		url: `${appUrl}/guilds/${id}`,
		lastModified: new Date(),
		changeFrequency: "daily" as const,
		priority: 0.5,
	}));

	return [...staticPages, ...articlePages, ...guildPages];
}
