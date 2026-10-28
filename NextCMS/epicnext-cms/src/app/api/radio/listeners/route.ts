import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

// Proxy for the configured radio "listeners" provider. The provider URL is
// stored in radio_listeners_api_url; we fetch it server-side with a short, hard
// timeout and reduce the response to a single listener count.

const FETCH_TIMEOUT_MS = 4000;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Best-effort listener-count extraction across the common provider shapes
// (AzureCast nests under listeners.current/total; others expose num_listeners,
// listeners, unique_listeners, count, or a bare number).
function findCount(value: unknown, depth = 0): number | null {
	if (depth > 4) return null;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (
		typeof value === "string" &&
		value.trim() !== "" &&
		Number.isFinite(Number(value))
	) {
		return Number(value);
	}
	if (!isRecord(value)) return null;

	const keys = [
		"current",
		"total",
		"num_listeners",
		"listeners",
		"unique_listeners",
		"count",
	];
	for (const key of keys) {
		// keys from hardcoded array
		const v = value[key];
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (
			typeof v === "string" &&
			v.trim() !== "" &&
			Number.isFinite(Number(v))
		) {
			return Number(v);
		}
	}
	for (const v of Object.values(value)) {
		if (isRecord(v)) {
			const found = findCount(v, depth + 1);
			if (found !== null) return found;
		}
	}
	return null;
}

export async function GET(_req: Request) {
	let url: string | null = null;
	try {
		url = (await siteSettings.get("radio_listeners_api_url", "")) || null;
	} catch {
		url = null;
	}

	// Not configured — no listener data available.
	if (!url) {
		return apiJson({ listeners: null });
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
			return apiJson({ listeners: null });
		}

		let parsed: unknown = raw;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// leave as raw string; findCount handles numeric strings.
		}

		return apiJson({ listeners: findCount(parsed) });
	} catch (e) {
		const aborted = e instanceof Error && e.name === "AbortError";
		return apiJson({
			listeners: null,
			error: aborted
				? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
				: "Fetch failed",
		});
	} finally {
		clearTimeout(timer);
	}
}
