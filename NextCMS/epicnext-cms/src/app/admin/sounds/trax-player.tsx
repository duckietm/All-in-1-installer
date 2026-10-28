"use client";

/**
 * Plays an Arcturus Trax composition by scheduling each sample on the
 * Web Audio API timeline.
 *
 * Format recap (see `@/lib/services/soundtracks`):
 *   channelN:sample_id,ticks;sample_id,ticks;…:channelM:…
 *   Each tick = 2 seconds. Channels play in parallel.
 *
 * We fetch each unique `sound_machine_sample_{id}.mp3`, decode it once,
 * then schedule AudioBufferSourceNode instances at `tickOffset * 2`
 * seconds relative to the master start time. Samples that end before
 * their tick slot simply fall silent until the next event — the slot
 * acts as an upper bound, not a forced loop.
 */

import { Loader2, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/browser-log";
import { TRAX_TICK_SECONDS, type TraxChannel } from "@/lib/trax-format";

const TICK_SECONDS = TRAX_TICK_SECONDS;

// Module-level registry so only one TraxPlayer plays at a time.
// When a new player starts, the previous one's stop() is invoked.
// `activeOwner` identifies the player via a stable object ref so each
// instance can tell "am I the current one?" without closing over callbacks.
let activeOwner: object | null = null;
let activeStop: (() => void) | null = null;

interface TraxPlayerProps {
	channels: TraxChannel[];
	/** URL prefix to prepend to `sound_machine_sample_{id}.mp3`. */
	baseUrl: string;
	/** Expected total length in seconds (used for the progress bar). */
	expectedLength: number;
}

type Status = "idle" | "loading" | "ready" | "playing" | "error";

export function TraxPlayer({
	channels,
	baseUrl,
	expectedLength,
}: TraxPlayerProps) {
	const [status, setStatus] = useState<Status>("idle");
	const [loaded, setLoaded] = useState(0);
	const [totalSamples, setTotalSamples] = useState(0);
	const [progress, setProgress] = useState(0);

	const ctxRef = useRef<AudioContext | null>(null);
	const buffersRef = useRef<Map<number, AudioBuffer>>(new Map());
	const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
	const startTimeRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	// Unique sample IDs referenced by the track (skip silence).
	const uniqueIds = Array.from(
		new Set(channels.flatMap((c) => c.events.map((e) => e.sampleId))),
	).filter((id) => id > 0);

	// Stable self-marker used to identify this instance in the module registry.
	const selfRef = useRef<object>({});

	const stop = useCallback(() => {
		for (const src of sourcesRef.current) {
			try {
				src.stop();
			} catch {
				/* already stopped */
			}
		}
		sourcesRef.current = [];
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		setStatus((prev) => (prev === "playing" ? "ready" : prev));
		setProgress(0);
		if (activeOwner === selfRef.current) {
			activeOwner = null;
			activeStop = null;
		}
	}, []);

	useEffect(() => {
		return () => {
			stop();
			ctxRef.current?.close();
			ctxRef.current = null;
		};
	}, [stop]);

	async function loadBuffers(): Promise<void> {
		setStatus("loading");
		setTotalSamples(uniqueIds.length);
		setLoaded(0);

		const AudioCtor = window.AudioContext;
		if (!AudioCtor) {
			toast.error("Web Audio API is not supported by this browser.");
			setStatus("error");
			return;
		}
		const ctx = ctxRef.current ?? new AudioCtor();
		ctxRef.current = ctx;

		const buffers = buffersRef.current;
		let done = 0;
		let failed = 0;

		await Promise.all(
			uniqueIds.map(async (id) => {
				if (buffers.has(id)) {
					done++;
					setLoaded(done);
					return;
				}
				try {
					const url = `${baseUrl}sound_machine_sample_${id}.mp3`;
					const res = await fetch(url);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const arr = await res.arrayBuffer();
					const buf = await ctx.decodeAudioData(arr);
					buffers.set(id, buf);
				} catch (err) {
					failed++;
					logger.warn(`[trax] failed to load sample ${id}`, {
						err: err as Error,
					});
				} finally {
					done++;
					setLoaded(done);
				}
			}),
		);

		if (failed > 0) {
			toast.warning(
				`${failed}/${uniqueIds.length} samples failed to load — playback may have gaps.`,
			);
		}
		if (failed === uniqueIds.length) {
			setStatus("error");
			return;
		}
		setStatus("ready");
	}

	async function play() {
		// Stop any other TraxPlayer currently playing.
		if (activeOwner && activeOwner !== selfRef.current) {
			activeStop?.();
		}

		if (status !== "ready") {
			await loadBuffers();
		}
		const ctx = ctxRef.current;
		if (!ctx) return;
		if (ctx.state === "suspended") await ctx.resume();

		stop(); // just in case
		const buffers = buffersRef.current;
		const start = ctx.currentTime + 0.05; // tiny head-start
		startTimeRef.current = start;
		const scheduled: AudioBufferSourceNode[] = [];

		for (const ch of channels) {
			let t = 0; // ticks from channel start
			for (const ev of ch.events) {
				if (ev.sampleId > 0) {
					const buf = buffers.get(ev.sampleId);
					if (buf) {
						const src = ctx.createBufferSource();
						src.buffer = buf;
						src.connect(ctx.destination);
						const when = start + t * TICK_SECONDS;
						const maxDur = ev.ticks * TICK_SECONDS;
						src.start(when, 0, Math.min(buf.duration, maxDur));
						scheduled.push(src);
					}
				}
				t += ev.ticks;
			}
		}
		sourcesRef.current = scheduled;
		setStatus("playing");
		activeOwner = selfRef.current;
		activeStop = stop;

		// Progress tick.
		const totalSec = Math.max(
			expectedLength,
			...channels.map(
				(c) => c.events.reduce((s, e) => s + e.ticks, 0) * TICK_SECONDS,
			),
		);
		const tick = () => {
			const elapsed = ctxRef.current
				? ctxRef.current.currentTime - startTimeRef.current
				: 0;
			const pct = totalSec > 0 ? Math.min(100, (elapsed / totalSec) * 100) : 0;
			setProgress(pct);
			if (elapsed >= totalSec) {
				stop();
				return;
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
	}

	const isBusy = status === "loading";
	const isPlaying = status === "playing";

	return (
		<div className="flex items-center gap-2 w-full">
			{isPlaying ? (
				<Button size="sm" variant="outline" onClick={stop}>
					<Square className="h-3 w-3 mr-1 fill-current" />
					Stop
				</Button>
			) : (
				<Button
					size="sm"
					onClick={play}
					disabled={isBusy || uniqueIds.length === 0}
				>
					{isBusy ? (
						<>
							<Loader2 className="h-3 w-3 mr-1 animate-spin" />
							{loaded}/{totalSamples}
						</>
					) : (
						<>
							<Play className="h-3 w-3 mr-1 fill-current" />
							Play Trax
						</>
					)}
				</Button>
			)}
			{isPlaying && (
				<div className="flex-1 h-2 rounded bg-muted overflow-hidden">
					<div
						className="h-full bg-primary transition-[width] duration-100"
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}
		</div>
	);
}
