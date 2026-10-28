/**
 * Arcturus Trax format parser — client-safe (no Node-only imports).
 *
 * Format (verified against doorman_frank, ballad_of_bonnie, bossa_nova on a
 * live DB):
 *
 *   channelN:event;event;…:channelM:event;event;…:
 *
 * Each `event` is `sample_id,duration`:
 *  - sample_id = 0 means silence.
 *  - duration = integer "ticks". One tick = 2 seconds of playback.
 *    (Verified: doorman_frank has 24 ticks × 2s = 48s = soundtracks.length.)
 *
 * All channels play in parallel starting at t=0, so the total soundtrack
 * length equals the max per-channel tick-sum × 2 seconds.
 */

export const TRAX_TICK_SECONDS = 2;

export interface TraxEvent {
	sampleId: number;
	ticks: number;
}

export interface TraxChannel {
	channel: number;
	events: TraxEvent[];
}

/** Split a raw track string into per-channel event lists. */
export function parseTraxChannels(
	track: string | null | undefined,
): TraxChannel[] {
	if (!track) return [];
	const channels: TraxChannel[] = [];
	for (const m of track.matchAll(/(\d+):([^:]+)/g)) {
		const channel = Number(m[1]);
		const events: TraxEvent[] = [];
		for (const raw of m[2].split(";")) {
			const pair = raw.match(/^(\d+),(\d+)$/);
			if (pair)
				events.push({ sampleId: Number(pair[1]), ticks: Number(pair[2]) });
		}
		if (events.length > 0) channels.push({ channel, events });
	}
	return channels;
}

/**
 * Parse a `track` string into the unique non-zero sample IDs it uses, sorted.
 * Returns [] for empty or unparseable tracks (i.e. single-sample song disks).
 */
export function parseTrackSamples(track: string | null | undefined): number[] {
	const set = new Set<number>();
	for (const ch of parseTraxChannels(track)) {
		for (const ev of ch.events) {
			if (ev.sampleId > 0) set.add(ev.sampleId);
		}
	}
	return [...set].sort((a, b) => a - b);
}

export function detectSoundtrackKind(
	track: string | null | undefined,
): "single" | "composition" {
	return parseTrackSamples(track).length > 0 ? "composition" : "single";
}
