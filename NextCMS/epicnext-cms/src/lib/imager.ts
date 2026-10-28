/**
 * Avatar imager helpers.
 *
 * Browser and server markup use the same runtime-configured avatar proxy.
 */

export type { AvatarOptions } from "@/types/admin";

import type { SyntheticEvent } from "react";
import { normalizeAvatarFigure } from "@/lib/avatar-figure";
import type { AvatarOptions } from "@/types/admin";

/**
 * Neutral silhouette (grayscale SVG) shown when even the fallback upstream
 * cannot produce a render — keeps a broken avatar from showing a broken-image
 * glyph anywhere on the site.
 */
export const AVATAR_FALLBACK_SRC =
	"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23e2e2e2'/%3E%3Ccircle cx='32' cy='24' r='11' fill='%239d9d9d'/%3E%3Cpath d='M10 60c5-10 13-14 22-14s17 4 22 14z' fill='%239d9d9d'/%3E%3C/svg%3E";

export function avatarImageOnError(event: SyntheticEvent<HTMLImageElement>) {
	const img = event.currentTarget;
	if (img.dataset.fallback) return;
	img.dataset.fallback = "1";
	img.src = AVATAR_FALLBACK_SRC;
}

/**
 * Build an avatar image URL using the configured imager.
 * Uses effect=14 and img_format=apng by default for epicnabbo.nl compatibility.
 * Preserves the user's stored figure so the rendered avatar matches the account.
 * Omits default parameters (direction=2, head_direction=3, size=m) for cleaner URLs.
 */
export function getAvatarUrl(
	figure: string,
	options: AvatarOptions = {},
): string {
	const {
		size = "m",
		direction = 2,
		headDirection = 3,
		headOnly = false,
		gesture,
		action,
		effect = 14,
		img_format = "apng",
	} = options;

	const params = new URLSearchParams({
		figure: normalizeAvatarFigure(figure),
		img_format,
		effect: String(effect),
	});

	// Only add non-default params
	if (direction !== 2) params.set("direction", String(direction));
	if (headDirection !== 3) params.set("head_direction", String(headDirection));
	if (size !== "m") params.set("size", size);

	if (headOnly) params.set("headonly", "1");
	if (gesture) params.set("gesture", gesture);
	if (action) params.set("action", action);

	const base = "/cms_api/imaging/avatar";
	return `${base}?${params.toString()}`;
}
