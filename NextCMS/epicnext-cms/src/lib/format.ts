import { getAvatarUrl } from "@/lib/imager";
import type { AvatarOptions } from "@/types/admin";

/** Build a Habbo avatar-imager URL for a figure string. */
export function avatarImageUrl(look: string, opts: AvatarOptions = {}): string {
	return getAvatarUrl(look, opts);
}

/** Build a proxied, cached badge image URL for a badge code. */
export function badgeImageUrl(code: string): string {
	return `/api/imaging/badge?code=${encodeURIComponent(code)}`;
}

/** URL-safe slug from a title (lowercase, ascii, hyphenated). */
export function slugify(input: string): string {
	// NFKD splits accented letters into base + combining mark; the combining
	// marks (and any other non-alphanumerics) are then collapsed to hyphens.
	const slug = input
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 255);
	return slug || "article";
}

/** Trim text to `max` chars on a word boundary, adding an ellipsis. */
export function excerpt(text: string, max = 160): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
