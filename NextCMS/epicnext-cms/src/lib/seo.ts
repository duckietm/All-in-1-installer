const FALLBACK_APP_URL = "http://localhost:3000";

/** Public origin of this installation, without a trailing slash. */
export function appBaseUrl(): string {
	return (process.env.APP_URL ?? FALLBACK_APP_URL).replace(/\/+$/, "");
}

/**
 * Turn a stored image path into an absolute URL for metadata / JSON-LD.
 * Returns null for values we cannot safely make absolute, so callers can fall
 * back to a default image instead of emitting an invalid URL.
 */
export function absoluteAssetUrl(
	value: string | null | undefined,
	base: string = appBaseUrl(),
): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	if (raw.startsWith("//")) return `https:${raw}`;
	if (/^https?:\/\//i.test(raw)) return raw;
	if (!raw.startsWith("/")) return null;
	try {
		return new URL(raw, base).toString();
	} catch {
		return null;
	}
}

/** Escape text for use in XML text nodes and attribute values. */
export function escapeXml(value: string): string {
	return value.replace(
		/[<>&'"]/g,
		(char) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				"'": "&apos;",
				'"': "&quot;",
			})[char] ?? char,
	);
}

export interface WebsiteStructuredDataOptions {
	hotelName: string;
	url: string;
	logo?: string | null;
}

/** WebSite + Organization JSON-LD for the landing page. */
export function buildWebsiteStructuredData({
	hotelName,
	url,
	logo,
}: WebsiteStructuredDataOptions): Record<string, unknown>[] {
	return [
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: hotelName,
			url,
			potentialAction: {
				"@type": "SearchAction",
				target: {
					"@type": "EntryPoint",
					urlTemplate: `${url}/search?q={search_term_string}`,
				},
				"query-input": "required name=search_term_string",
			},
		},
		{
			"@context": "https://schema.org",
			"@type": "Organization",
			name: hotelName,
			url,
			...(logo ? { logo } : {}),
		},
	];
}

export interface ArticleStructuredDataOptions {
	hotelName: string;
	url: string;
	title: string;
	description: string;
	image?: string | null;
	logo?: string | null;
	publishedAt?: string | null;
	modifiedAt?: string | null;
}

/** NewsArticle JSON-LD for a public article. */
export function buildArticleStructuredData({
	hotelName,
	url,
	title,
	description,
	image,
	logo,
	publishedAt,
	modifiedAt,
}: ArticleStructuredDataOptions): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "NewsArticle",
		headline: title,
		description,
		url,
		...(image ? { image: [image] } : {}),
		...(publishedAt ? { datePublished: publishedAt } : {}),
		...(modifiedAt ? { dateModified: modifiedAt } : {}),
		author: { "@type": "Organization", name: hotelName },
		publisher: {
			"@type": "Organization",
			name: hotelName,
			...(logo ? { logo: { "@type": "ImageObject", url: logo } } : {}),
		},
		mainEntityOfPage: { "@type": "WebPage", "@id": url },
	};
}
