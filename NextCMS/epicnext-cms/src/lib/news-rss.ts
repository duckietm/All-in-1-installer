import { absoluteAssetUrl, escapeXml } from "@/lib/seo";

export interface NewsRssItem {
	slug: string;
	title: string;
	shortStory: string;
	image: string;
	createdAt: Date | null;
}

function imageMime(url: string): string {
	const extension = url.split("?")[0]?.split(".").pop()?.toLowerCase();
	switch (extension) {
		case "png":
			return "image/png";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "avif":
			return "image/avif";
		default:
			return "image/jpeg";
	}
}

/** Build a standards-compliant RSS 2.0 feed for the public news archive. */
export function buildNewsRss(
	items: NewsRssItem[],
	options: { hotelName: string; appUrl: string; now?: Date },
): string {
	const base = options.appUrl.replace(/\/+$/, "");
	const now = options.now ?? new Date();

	const entries = items
		.map((item) => {
			const url = `${base}/news/${encodeURIComponent(item.slug)}`;
			const image = absoluteAssetUrl(item.image, base);
			return [
				"<item>",
				`<title>${escapeXml(item.title)}</title>`,
				`<link>${escapeXml(url)}</link>`,
				`<guid isPermaLink="true">${escapeXml(url)}</guid>`,
				item.createdAt
					? `<pubDate>${item.createdAt.toUTCString()}</pubDate>`
					: "",
				`<description>${escapeXml(item.shortStory)}</description>`,
				image
					? `<enclosure url="${escapeXml(image)}" type="${imageMime(image)}" length="0" />`
					: "",
				"</item>",
			]
				.filter(Boolean)
				.join("");
		})
		.join("");

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		"<channel>",
		`<title>${escapeXml(`${options.hotelName} — News`)}</title>`,
		`<link>${escapeXml(`${base}/news`)}</link>`,
		`<description>${escapeXml(`Latest news from ${options.hotelName}`)}</description>`,
		"<language>en</language>",
		`<atom:link href="${escapeXml(`${base}/news/rss.xml`)}" rel="self" type="application/rss+xml" />`,
		`<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
		entries,
		"</channel>",
		"</rss>",
	].join("");
}
