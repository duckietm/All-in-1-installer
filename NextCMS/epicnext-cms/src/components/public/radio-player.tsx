"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/browser-log";
import { useEventSource } from "@/lib/use-event-source";

/**
 * Fixed bottom-right radio player widget — the Next.js port of AtomCMS's
 * `radio-player.blade.php` (atom theme). A compact bar that streams the hotel
 * radio via a hidden <audio> element, with play/pause, a volume slider, the
 * current DJ / now-playing text, and a live listener count.
 *
 * It is a CLIENT component and must NOT import db / siteSettings.
 * Config is fetched once on mount; now-playing + listeners come via SSE
 * (/cms_api/radio/stream) for real-time updates.
 *
 * If the radio is disabled or no stream URL is configured, it renders nothing.
 * The server-side <RadioPlayerGate> already guards on the same settings so the
 * widget JS isn't shipped when off — this in-component guard is belt-and-braces
 * for the runtime config refresh.
 */

type RadioConfig = {
	enabled: boolean;
	streamUrl: string;
	name: string;
};

// ── Defensive parsing of the loosely-typed provider passthroughs ──────────────

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isTruthyFlag(v: unknown): boolean {
	const s = asString(v).trim().toLowerCase();
	return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Parse /cms_api/radio/config (flat radio_* settings map) into the bits we need. */
function parseConfig(data: unknown): RadioConfig {
	const c = isRecord(data) ? data : {};
	// radio_enabled defaults to off when the key is absent.
	const enabled = "radio_enabled" in c ? isTruthyFlag(c.radio_enabled) : false;
	return {
		enabled,
		streamUrl: asString(c.radio_stream_url).trim(),
		name: asString(c.radio_name).trim() || "Radio",
	};
}

/**
 * Extract a "now playing" line from the now-playing passthrough, covering the
 * shapes the AtomCMS blade handled plus the AzureCast `now_playing.song.*`
 * nesting our proxy may surface. Falls back to a generic label.
 */
function parseNowPlaying(data: unknown): string {
	if (!isRecord(data)) {
		const s = asString(data).trim();
		return s || "Live radio";
	}

	const joinSongArtist = (song: unknown, artist: unknown): string | null => {
		const s = asString(song).trim();
		const a = asString(artist).trim();
		if (s && a) return `${a} — ${s}`;
		if (s) return s;
		return null;
	};

	// Our proxy's raw-text fallback shape: { nowPlaying: "…" }.
	const np = asString(data.nowPlaying).trim();
	if (np) return np;

	// { song, artist } / { title, artist } at the top level.
	const top =
		joinSongArtist(data.song, data.artist) ??
		joinSongArtist(data.title, data.artist);
	if (top) return top;

	// AzureCast: { now_playing: { song: { title, artist, text } } }.
	if (isRecord(data.now_playing)) {
		const inner = data.now_playing;
		if (isRecord(inner.song)) {
			const s = inner.song;
			const text = asString(s.text).trim();
			if (text) return text;
			const made = joinSongArtist(s.title, s.artist);
			if (made) return made;
		}
		const made =
			joinSongArtist(inner.song, inner.artist) ??
			joinSongArtist(inner.title, inner.artist);
		if (made) return made;
	}

	return "Live radio";
}

/** Extract the current DJ / show name when the provider exposes one. */
function parseDj(data: unknown): string {
	if (!isRecord(data)) return "";
	const candidates: unknown[] = [
		data.dj,
		data.show_name,
		data.streamer,
		data.show,
	];
	if (isRecord(data.live)) {
		candidates.push(data.live.streamer_name, data.live.streamer);
	}
	for (const c of candidates) {
		if (isRecord(c)) {
			const name =
				asString(c.username).trim() ||
				asString(c.show_name).trim() ||
				asString(c.name).trim();
			if (name) return name;
		} else {
			const s = asString(c).trim();
			if (s) return s;
		}
	}
	return "";
}

/** Extract the listener count from /cms_api/radio/listeners ({ listeners }). */
function parseListeners(data: unknown): number | null {
	if (!isRecord(data)) return null;
	const v = data.listeners;
	if (typeof v === "number" && Number.isFinite(v)) return v;
	return null;
}

export default function RadioPlayer() {
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const [config, setConfig] = useState<RadioConfig | null>(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(50); // 0–100
	const [nowPlaying, setNowPlaying] = useState("Loading…");
	const [dj, setDj] = useState("");
	const [listeners, setListeners] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Subscribe to SSE stream for real-time now-playing + listeners.
	const { data: streamData } = useEventSource<{
		nowPlaying: unknown;
		listeners: number | null;
	}>("/cms_api/radio/stream", { enabled: true });

	useEffect(() => {
		if (!streamData) return;
		if (streamData.nowPlaying != null) {
			setNowPlaying(parseNowPlaying(streamData.nowPlaying));
			setDj(parseDj(streamData.nowPlaying));
		}
		if (streamData.listeners != null) {
			setListeners(parseListeners({ listeners: streamData.listeners }));
		}
	}, [streamData]);

	// Fetch config once on mount (rarely changes).
	useEffect(() => {
		fetch("/cms_api/radio/config", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data !== null) setConfig(parseConfig(data));
			})
			.catch((error) =>
				logger.error("[Radio] Config fetch failed", {
					err: error as Error,
				}),
			);
	}, []);

	// Keep the <audio> volume in sync with the slider.
	useEffect(() => {
		if (audioRef.current) audioRef.current.volume = volume / 100;
	}, [volume]);

	const toggle = useCallback(async () => {
		const audio = audioRef.current;
		const streamUrl = config?.streamUrl;
		if (!audio || !streamUrl) return;

		if (playing) {
			audio.pause();
			setPlaying(false);
			return;
		}

		setError(null);
		// (Re)point at the live stream each time we start so we never replay a
		// buffered segment of a continuous broadcast.
		if (audio.src !== streamUrl) audio.src = streamUrl;
		audio.volume = volume / 100;
		try {
			await audio.play();
			setPlaying(true);
		} catch {
			setError("Couldn't start playback. Check your browser settings.");
			setPlaying(false);
		}
	}, [config?.streamUrl, playing, volume]);

	// Disabled or unconfigured → render nothing (and ship no widget UI).
	if (!config?.enabled || !config.streamUrl) return null;

	const surface = "var(--color-surface)";
	const primary = "var(--color-primary)";
	const text = "var(--color-text)";
	const muted = "var(--color-text-muted)";
	const border = "color-mix(in srgb, var(--color-text-muted) 18%, transparent)";

	return (
		<section
			// Entrance is CSS (.radio-player-enter) rather than motion/react: the
			// player sits on every public page, and that library is a ~43 KB chunk.
			className="radio-player-enter"
			aria-label={`${config.name} player`}
			style={{
				position: "fixed",
				bottom: "1rem",
				right: "1rem",
				zIndex: 9999,
				width: "min(20rem, calc(100vw - 2rem))",
				background: surface,
				color: text,
				border: `1px solid ${border}`,
				borderRadius: "14px",
				boxShadow: "0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.12)",
				padding: "0.7rem 0.85rem",
				fontFamily: "inherit",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
				<button
					type="button"
					onClick={() => void toggle()}
					aria-label={playing ? "Pause radio" : "Play radio"}
					aria-pressed={playing}
					style={{
						flex: "none",
						width: "38px",
						height: "38px",
						borderRadius: "999px",
						display: "grid",
						placeItems: "center",
						border: "none",
						cursor: "pointer",
						background: primary,
						color:
							"var(--button-text-color-readable, var(--button-text-color))",
						fontSize: "1rem",
						lineHeight: 1,
					}}
				>
					<span aria-hidden>{playing ? "⏸" : "▶"}</span>
				</button>

				<div style={{ minWidth: 0, flex: 1 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.4rem",
							fontSize: "0.7rem",
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: "0.04em",
							color: primary,
						}}
					>
						<span
							aria-hidden
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "999px",
								background: playing ? "#16a34a" : muted,
								boxShadow: playing
									? "0 0 0 3px color-mix(in srgb, #16a34a 22%, transparent)"
									: "none",
							}}
						/>
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{config.name}
							{dj ? ` · ${dj}` : ""}
						</span>
					</div>
					<div
						title={nowPlaying}
						style={{
							marginTop: "0.1rem",
							fontSize: "0.8rem",
							fontWeight: 600,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{nowPlaying}
					</div>
				</div>

				<span
					style={{
						flex: "none",
						display: "inline-flex",
						alignItems: "center",
						gap: "0.25rem",
						fontSize: "0.75rem",
						fontWeight: 700,
						color: muted,
					}}
				>
					<span aria-hidden>👥</span>
					<span aria-hidden>
						{listeners != null ? listeners.toLocaleString() : "--"}
					</span>
				</span>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "0.5rem",
					marginTop: "0.55rem",
				}}
			>
				<span
					aria-hidden
					style={{ fontSize: "0.85rem", color: muted, lineHeight: 1 }}
				>
					🔈
				</span>
				<input
					type="range"
					min={0}
					max={100}
					value={volume}
					onChange={(e) => setVolume(Number(e.target.value))}
					aria-label="Volume"
					style={{
						flex: 1,
						height: "4px",
						cursor: "pointer",
						accentColor: "var(--color-primary)",
						padding: 0,
					}}
				/>
			</div>

			{error ? (
				<p
					role="alert"
					aria-live="polite"
					style={{
						margin: "0.45rem 0 0",
						fontSize: "0.72rem",
						color: "var(--color-danger)",
					}}
				>
					{error}
				</p>
			) : null}

			{/* Hidden stream element. preload="none" so nothing loads until the user
          hits play (and browsers block autoplay with sound regardless). */}
			<audio ref={audioRef} preload="none">
				<track kind="captions" />
			</audio>
		</section>
	);
}
