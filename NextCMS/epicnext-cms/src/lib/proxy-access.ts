export interface ProxyToken {
	sub?: string;
	rank?: unknown;
}

export function shouldRedirectAdminRequest(
	pathname: string,
	token: ProxyToken | null,
): boolean {
	if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
	return token === null;
}

const CACHEABLE_ASSET_PREFIXES = ["/cms_api/imaging/", "/cms_api/media/"];

export function isCacheableAssetPath(pathname: string): boolean {
	return CACHEABLE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Public pages whose anonymous rendering barely changes between visitors:
 * leaderboards, news, events, staff listing, rankings and the radio schedule.
 * These are safe to share at the edge for a few seconds while
 * stale-while-revalidate keeps the origin from seeing a stampede.
 */
const EDGE_CACHEABLE_PREFIXES = [
	"/leaderboard",
	"/rankings",
	"/news",
	"/staff",
	"/events",
	"/radio/schedule",
	"/community",
	"/rares",
	"/shop",
	"/badges",
	"/developers",
	"/help",
	"/guilds",
];

export function isEdgeCacheablePublicPath(pathname: string): boolean {
	if (
		pathname !== "/" &&
		EDGE_CACHEABLE_PREFIXES.some(
			(p) => pathname === p || pathname.startsWith(`${p}/`),
		)
	)
		return true;
	return false;
}
