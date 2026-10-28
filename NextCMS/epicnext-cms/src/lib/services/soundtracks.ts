/**
 * Soundtrack (Song Disks) service helpers.
 *
 * Storage layout:
 *   MP3 files live at public/swf/dcr/hof_furni/mp3/{code}.mp3
 *   Public URL:       /swf/dcr/hof_furni/mp3/{code}.mp3
 *
 * This is the same directory used by Arcturus for the trax sample set
 * (`sound_machine_sample_<N>.mp3`). Keeping uploads alongside existing
 * samples means they resolve via the same URL base and play without
 * extra middleware config.
 *
 * The public URL prefix is configurable via the CMS setting
 * `soundtrack_base_url` — see site-settings.ts defaults.
 */
import { promises as fs } from "node:fs";
import { parseBuffer } from "music-metadata";
import { getRuntimePath } from "@/lib/utils/runtime-path";

// ── Constants ──────────────────────────────────────────────────────

/** On-disk directory where MP3s live. Fixed (not configurable from UI to
 *  avoid any path traversal risk). */
export const SOUNDTRACK_DIR = getRuntimePath(
	process.cwd(),
	"public",
	"swf",
	"dcr",
	"hof_furni",
	"mp3",
);

/** Default public URL prefix (with trailing slash). Can be overridden via
 *  the `soundtrack_base_url` CMS setting. */
export const DEFAULT_SOUNDTRACK_BASE_URL = "/swf/dcr/hof_furni/mp3/";

/** 10 MB hard limit per upload. */
export const MAX_SOUNDTRACK_SIZE = 10 * 1024 * 1024;

// ── File paths ─────────────────────────────────────────────────────

/** Reject codes that would escape the sounds directory or use unsafe chars. */
export function isSafeSoundtrackCode(code: string): boolean {
	return /^[a-zA-Z0-9_-]{1,32}$/.test(code);
}

export function getSoundtrackPath(code: string): string {
	if (!isSafeSoundtrackCode(code)) {
		throw new Error(`Unsafe soundtrack code: ${code}`);
	}
	return getRuntimePath(SOUNDTRACK_DIR, `${code}.mp3`);
}

/** Ensure the sounds directory exists (mkdir -p). */
export async function ensureSoundtrackDir(): Promise<void> {
	await fs.mkdir(SOUNDTRACK_DIR, { recursive: true });
}

// ── Validation ─────────────────────────────────────────────────────

/**
 * Verify the buffer starts with an MP3 header.
 * Accepts:
 *   - ID3v2 tag header ("ID3")
 *   - Raw MPEG sync byte 0xFF followed by 0xFA / 0xFB / 0xFE / 0xF3 / 0xF2
 *     (covers MPEG-1/2 Layer III common variants)
 *
 * This is a best-effort check — not a full parse — but it rejects arbitrary
 * files masquerading as .mp3 (e.g. renamed .exe).
 */
export function validateMp3Bytes(buf: Buffer): boolean {
	if (buf.length < 4) return false;

	// ID3v2 tag header
	if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;

	// MPEG sync: 0xFF followed by 0xFA/0xFB/0xFE/0xF3/0xF2
	if (buf[0] === 0xff) {
		const b = buf[1];
		if (b === 0xfa || b === 0xfb || b === 0xfe || b === 0xf3 || b === 0xf2)
			return true;
	}

	return false;
}

/**
 * Extract MP3 duration in seconds (integer, rounded).
 * Returns 0 if metadata cannot be parsed.
 */
export async function extractMp3Duration(buf: Buffer): Promise<number> {
	try {
		const meta = await parseBuffer(
			buf,
			{ mimeType: "audio/mpeg" },
			{ duration: true },
		);
		const seconds = meta.format.duration;
		if (
			typeof seconds !== "number" ||
			!Number.isFinite(seconds) ||
			seconds <= 0
		)
			return 0;
		return Math.round(seconds);
	} catch {
		return 0;
	}
}

// ── File I/O ───────────────────────────────────────────────────────

/**
 * Write the MP3 payload to disk under the given code.
 * Creates the parent directory if missing.
 */
export async function writeSoundtrackFile(
	code: string,
	buf: Buffer,
): Promise<void> {
	await ensureSoundtrackDir();
	await fs.writeFile(getSoundtrackPath(code), buf);
}

/**
 * Remove the MP3 file for the given code. No-op if the file is already gone.
 */
export async function deleteSoundtrackFile(code: string): Promise<void> {
	try {
		await fs.unlink(getSoundtrackPath(code));
	} catch (err) {
		const errCode = (err as NodeJS.ErrnoException).code;
		if (errCode === "ENOENT") return;
		throw err;
	}
}

export type { TraxChannel, TraxEvent } from "@/lib/trax-format";
// Re-export the Trax format parser for server-side use. The actual
// implementation lives in `@/lib/trax-format` so it can be imported by
// client components without pulling in Node-only deps from this file.
export { parseTrackSamples } from "@/lib/trax-format";
