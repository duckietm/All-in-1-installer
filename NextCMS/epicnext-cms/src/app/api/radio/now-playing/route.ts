import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

// Proxy for the configured radio "now playing" provider. The provider URL is
// stored in radio_now_playing_api_url; we fetch it server-side (never exposing
// the URL or any provider key to the browser) with a short, hard timeout.

const FETCH_TIMEOUT_MS = 4000;

export async function GET(_req: Request) {
	let url: string | null = null;
	try {
		url = (await siteSettings.get("radio_now_playing_api_url", "")) || null;
	} catch {
		url = null;
	}

	// Not configured — there is nothing to play.
	if (!url) {
		return apiJson({ nowPlaying: null });
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
			headers: { accept: "application/json, text/plain, */*" },
		});

		const raw = (await res.text()).trim();
		if (raw === "") {
			return apiJson({ nowPlaying: null });
		}

		// Return parsed JSON when the provider speaks JSON, else the raw text body.
		try {
			return apiJson(JSON.parse(raw));
		} catch {
			return apiJson({ nowPlaying: raw.slice(0, 2000) });
		}
	} catch (e) {
		const aborted = e instanceof Error && e.name === "AbortError";
		return apiJson({
			error: aborted
				? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
				: "Fetch failed",
		});
	} finally {
		clearTimeout(timer);
	}
}
