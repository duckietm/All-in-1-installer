/**
 * Client-safe avatar figure rules, shared by the URL builder (`imager.ts`) and
 * the server-side query parser (`imager-upstream.ts`).
 *
 * The imager is the authority on what it can draw: a figure with an empty part
 * slot (e.g. `hr-100-.hd-180-1.ch-255-66`) is rejected with 400 "Invalid figure
 * format". Legacy accounts can still carry such stored looks, so the URL
 * builder normalises them to a valid default instead of emitting a request that
 * renders as a broken image.
 */

/** Valid starter figure — also the default look new accounts are given. */
export const DEFAULT_AVATAR_FIGURE =
	"hr-100-1.hd-180-1.ch-255-66.lg-280-110.sh-305-62";

/**
 * The first segment must look like a real part (`hd-180`); the rest is
 * deliberately loose because some clients append extra segments (e.g. a
 * trailing `.0`) that the renderer still accepts. Over-strict validation here
 * turned valid avatars into 400s.
 */
export const AVATAR_FIGURE_RE = /^[a-z]{2}-\d+(?:[.-][a-z0-9]+)*$/i;
export const AVATAR_FIGURE_MAX_LEN = 512;
export const AVATAR_FIGURE_MAX_PARTS = 24;

/**
 * Return `figure` unchanged when the imager can draw it, otherwise the default
 * figure. Trims surrounding whitespace either way.
 */
export function normalizeAvatarFigure(figure: string): string {
	const trimmed = figure.trim();
	if (!trimmed || trimmed.length > AVATAR_FIGURE_MAX_LEN)
		return DEFAULT_AVATAR_FIGURE;
	if (!AVATAR_FIGURE_RE.test(trimmed)) return DEFAULT_AVATAR_FIGURE;
	if (trimmed.split(".").length > AVATAR_FIGURE_MAX_PARTS)
		return DEFAULT_AVATAR_FIGURE;
	return trimmed;
}
