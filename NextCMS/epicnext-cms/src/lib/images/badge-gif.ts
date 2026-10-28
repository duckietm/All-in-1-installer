import "server-only";

import sharp from "sharp";

/** Habbo-style badge icons are small; keep within this box without upscaling. */
const MAX_BADGE_EDGE = 64;

/**
 * Normalize an uploaded badge image to GIF bytes for the emulator album folder.
 * Accepts PNG or GIF input; re-encodes and optionally downsizes oversized assets.
 */
export async function toBadgeGif(input: Buffer): Promise<Buffer> {
	return sharp(input)
		.resize({
			width: MAX_BADGE_EDGE,
			height: MAX_BADGE_EDGE,
			fit: "inside",
			withoutEnlargement: true,
		})
		.gif()
		.toBuffer();
}
