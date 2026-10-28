import { resolveHotelName } from "@/lib/hotel-name";
import { buildNewsRss } from "@/lib/news-rss";
import { appBaseUrl } from "@/lib/seo";
import { getNewsList } from "@/lib/services/news-list";

// Built per request so the feed never needs a database connection during
// `next build`, matching the sitemap and robots routes.
export const dynamic = "force-dynamic";

export async function GET() {
	const [hotelName, items] = await Promise.all([
		resolveHotelName(),
		getNewsList(30),
	]);

	return new Response(
		buildNewsRss(items, { hotelName, appUrl: appBaseUrl() }),
		{
			headers: {
				"Content-Type": "application/rss+xml; charset=utf-8",
				"Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
			},
		},
	);
}
