import { getTranslations } from "next-intl/server";
import { DiagnosticRow, StatusCard } from "@/components/admin/dashboard";
import { siteSettings } from "@/lib/services/site-settings";

export const metadata = { title: "Radio Monitoring" };

const FETCH_TIMEOUT_MS = 4000;

type ProbeResult = {
	reachable: boolean;
	status: number | null;
	json: unknown;
	text: string | null;
	error: string | null;
};

async function probe(url: string): Promise<ProbeResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
			headers: { accept: "application/json, text/plain, */*" },
		});
		const raw = await res.text();
		let json: unknown = null;
		let text: string | null = null;
		const trimmed = raw.trim();
		if (trimmed !== "") {
			try {
				json = JSON.parse(trimmed);
			} catch {
				text = trimmed.slice(0, 2000);
			}
		}
		return {
			reachable: res.ok,
			status: res.status,
			json,
			text,
			error: res.ok ? null : `HTTP ${res.status}`,
		};
	} catch (e) {
		const aborted = e instanceof Error && e.name === "AbortError";
		return {
			reachable: false,
			status: null,
			json: null,
			text: null,
			error: aborted
				? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
				: "Fetch failed",
		};
	} finally {
		clearTimeout(timer);
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
	// only called with hardcoded keys
	const v = obj[key];
	return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function parseNowPlaying(result: ProbeResult): string | null {
	if (result.json == null) {
		return result.text && result.text.length <= 200 ? result.text : null;
	}
	const data = result.json;
	if (typeof data === "string") return data.trim() || null;
	if (!isRecord(data)) return null;

	const np = data.now_playing;
	if (typeof np === "string" && np.trim() !== "") return np.trim();
	if (isRecord(np)) {
		const song = np.song;
		if (isRecord(song)) {
			const title = pickString(song, "title");
			const artist = pickString(song, "artist");
			if (title || artist) {
				return [artist, title].filter(Boolean).join(" - ");
			}
			const txt = pickString(song, "text");
			if (txt) return txt;
		}
	}

	const song = data.song;
	if (isRecord(song)) {
		const title = pickString(song, "title");
		const artist = pickString(song, "artist");
		if (title || artist) return [artist, title].filter(Boolean).join(" - ");
	}
	const title = pickString(data, "title");
	const artist = pickString(data, "artist");
	if (title || artist) return [artist, title].filter(Boolean).join(" - ");

	return pickString(data, "text") ?? pickString(data, "song") ?? null;
}

function findNumberDeep(
	value: unknown,
	keys: string[],
	depth = 0,
): number | null {
	if (depth > 4) return null;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (!isRecord(value)) return null;
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
			const found = findNumberDeep(v, keys, depth + 1);
			if (found !== null) return found;
		}
	}
	return null;
}

function parseListeners(result: ProbeResult): number | null {
	if (result.json == null) {
		if (result.text && Number.isFinite(Number(result.text.trim()))) {
			return Number(result.text.trim());
		}
		return null;
	}
	const data = result.json;
	if (typeof data === "number" && Number.isFinite(data)) return data;
	return findNumberDeep(data, [
		"current",
		"total",
		"num_listeners",
		"listeners",
		"unique_listeners",
		"count",
	]);
}

function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		return u.host + (u.pathname === "/" ? "" : u.pathname);
	} catch {
		return url.length > 60 ? `${url.slice(0, 57)}\u2026` : url;
	}
}

export default async function AdminRadioMonitoringPage() {
	const t = await getTranslations("pages.admin.radio");

	let nowPlayingUrl: string | null = null;
	let listenersUrl: string | null = null;
	let streamUrl: string | null = null;
	try {
		nowPlayingUrl =
			(await siteSettings.get("radio_now_playing_api_url", "")) || null;
		listenersUrl =
			(await siteSettings.get("radio_listeners_api_url", "")) || null;
		streamUrl = (await siteSettings.get("radio_stream_url", "")) || null;
	} catch {
		nowPlayingUrl = null;
		listenersUrl = null;
		streamUrl = null;
	}

	const nowPlayingResult = nowPlayingUrl ? await probe(nowPlayingUrl) : null;
	const listenersResult = listenersUrl ? await probe(listenersUrl) : null;

	const nowPlaying = nowPlayingResult
		? parseNowPlaying(nowPlayingResult)
		: null;
	const listeners = listenersResult ? parseListeners(listenersResult) : null;

	const streamProbe = nowPlayingResult ?? listenersResult;
	const streamOnline = streamProbe?.reachable ?? false;
	const streamConfigured = Boolean(nowPlayingUrl || listenersUrl);

	const endpoints: {
		label: string;
		url: string | null;
		result: ProbeResult | null;
	}[] = [
		{
			label: t("monitoring.nowPlayingApi"),
			url: nowPlayingUrl,
			result: nowPlayingResult,
		},
		{
			label: t("monitoring.listenersApi"),
			url: listenersUrl,
			result: listenersResult,
		},
	];

	return (
		<main>
			<section className="mt-6">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label={t("monitoring.stream")}
						value={
							!streamConfigured
								? t("monitoring.notConfigured")
								: streamOnline
									? t("monitoring.online")
									: t("monitoring.offline")
						}
						state={
							!streamConfigured ? "neutral" : streamOnline ? "ok" : "danger"
						}
						hint={streamUrl ? shortUrl(streamUrl) : undefined}
						icon="📡"
					/>
					<StatusCard
						label={t("monitoring.nowPlaying")}
						value={nowPlaying ?? "\u2014"}
						state={nowPlaying ? "ok" : "neutral"}
						hint={!nowPlayingUrl ? t("monitoring.noNowPlayingHint") : undefined}
						icon="🎵"
					/>
					<StatusCard
						label={t("monitoring.listeners")}
						value={listeners ?? "\u2014"}
						state={listeners != null ? "ok" : "neutral"}
						hint={!listenersUrl ? t("monitoring.noListenersHint") : undefined}
						icon="🎧"
					/>
				</div>
			</section>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("monitoring.endpointDiagnostics")}
				</h2>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					{t("monitoring.diagnosticsLegend")}
				</p>
				<div className="flex flex-col">
					{endpoints.map((ep) => {
						let state: "ok" | "warn" | "danger";
						let detail: string;
						if (!ep.url) {
							state = "warn";
							detail = t("monitoring.notConfigured");
						} else if (ep.result?.reachable) {
							state = "ok";
							detail = `${shortUrl(ep.url)}${
								ep.result.status != null
									? ` \u00B7 HTTP ${ep.result.status}`
									: ""
							}`;
						} else {
							state = "danger";
							detail = `${shortUrl(ep.url)} \u00B7 ${ep.result?.error ?? t("monitoring.unreachable")}`;
						}
						return (
							<DiagnosticRow
								key={ep.label}
								label={ep.label}
								detail={detail}
								state={state}
							/>
						);
					})}
					<DiagnosticRow
						label={t("monitoring.streamUrl")}
						detail={
							streamUrl ? shortUrl(streamUrl) : t("monitoring.notConfigured")
						}
						state={streamUrl ? "ok" : "warn"}
					/>
				</div>
			</section>
		</main>
	);
}
