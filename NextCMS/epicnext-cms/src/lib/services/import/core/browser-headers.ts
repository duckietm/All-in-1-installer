export type BrowserFetchDest =
	| "document"
	| "image"
	| "script"
	| "style"
	| "empty";

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const SEC_CH_UA =
	'"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"';

/**
 * Realistic browser request headers so CDNs (Cloudflare, etc.) treat the
 * server-side fetches as a normal browser instead of a bot/curl and block us.
 */
export function browserHeaders(
	dest: BrowserFetchDest = "empty",
	extra: Record<string, string> = {},
): Record<string, string> {
	const accept =
		dest === "document"
			? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
			: dest === "image"
				? "image/avif,image/webp,image/apng,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5"
				: dest === "script"
					? "*/*"
					: "application/json,text/plain,*/*;q=0.9";

	const headers: Record<string, string> = {
		"User-Agent": CHROME_UA,
		"sec-ch-ua": SEC_CH_UA,
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": '"Windows"',
		Accept: accept,
		"Accept-Language": "en-US,en;q=0.9",
		"Sec-Fetch-Site": "cross-site",
		"Sec-Fetch-Mode":
			dest === "document" ? "navigate" : dest === "image" ? "no-cors" : "cors",
		"Sec-Fetch-Dest": dest,
		"Cache-Control": "no-cache",
		Pragma: "no-cache",
	};

	if (dest === "document") headers["Upgrade-Insecure-Requests"] = "1";

	return { ...headers, ...extra };
}
