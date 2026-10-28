import { isSafeOutboundUrl } from "@/lib/import-url-safety";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * Best-effort radio stream helpers, shared by the public API and the jobs
 * worker. They poll the now-playing / listeners endpoints configured in
 * website_settings (AzureCast / Icecast / Shoutcast all differ), parsing the
 * common shapes. Everything fails soft (returns null) on error/missing config.
 */

// Block SSRF: only http/https to hosts that resolve to public addresses (isSafeOutboundUrl),
// and no redirects (a public host could redirect to a private one).

export interface NowPlaying {
	title: string;
	artist: string | null;
}

// Shared in-process poll cache: every connected SSE client (players, widgets)
// would otherwise hit the radio API once per 10s each. With one cache entry per
// endpoint, N connections cost 1 request per interval regardless of N.
const POLL_CACHE_TTL_MS = 10_000;
const pollCache = new Map<string, { data: unknown; expiresAt: number }>();

async function cachedFetchJson(url: string, ms = 4000): Promise<unknown> {
	const now = Date.now();
	const hit = pollCache.get(url);
	if (hit && hit.expiresAt > now) return hit.data;
	const data = await fetchJson(url, ms);
	pollCache.set(url, { data, expiresAt: now + POLL_CACHE_TTL_MS });
	return data;
}

async function fetchJson(url: string, ms = 4000): Promise<unknown> {
	if (!(await isSafeOutboundUrl(url, { allowHttp: true }))) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
			redirect: "manual",
		});
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch {
			return text; // plain-text "Artist - Title" (Shoutcast/Icecast metadata)
		}
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function parseNowPlaying(d: unknown): NowPlaying | null {
	if (!d) return null;
	// AzureCast: { now_playing: { song: { title, artist } } }
	const azure = (
		d as {
			now_playing?: {
				song?: { title?: string; artist?: string; text?: string };
			};
		}
	).now_playing?.song;
	if (azure?.title || azure?.text) {
		return {
			title: azure.title ?? azure.text ?? "",
			artist: azure.artist ?? null,
		};
	}
	// Generic JSON: { title, artist } or { songtitle }
	const generic = d as { title?: string; artist?: string; songtitle?: string };
	if (generic.title)
		return { title: generic.title, artist: generic.artist ?? null };
	if (generic.songtitle) {
		const [a, t] = generic.songtitle.split(" - ");
		return t
			? { title: t.trim(), artist: a.trim() }
			: { title: generic.songtitle, artist: null };
	}
	// Plain text "Artist - Title"
	if (typeof d === "string" && d.trim()) {
		const parts = d.split(" - ");
		return parts.length > 1
			? { title: parts.slice(1).join(" - ").trim(), artist: parts[0].trim() }
			: { title: d.trim(), artist: null };
	}
	return null;
}

export async function fetchNowPlaying(): Promise<NowPlaying | null> {
	const url = (await siteSettings.get("radio_now_playing_api_url", "")) ?? "";
	if (!url) return null;
	return parseNowPlaying(await cachedFetchJson(url));
}

export async function fetchListeners(): Promise<number | null> {
	const url = (await siteSettings.get("radio_listeners_api_url", "")) ?? "";
	if (!url) return null;
	const d = await cachedFetchJson(url);
	if (d == null) return null;
	const obj = d as { listeners?: unknown; current_listeners?: unknown };
	const raw =
		typeof d === "number"
			? d
			: (obj.listeners ??
				obj.current_listeners ??
				(typeof d === "string" ? Number(d) : null));
	const n = Number(
		typeof raw === "object" &&
			raw &&
			"total" in (raw as Record<string, unknown>)
			? (raw as { total: unknown }).total
			: raw,
	);
	return Number.isFinite(n) ? n : null;
}
