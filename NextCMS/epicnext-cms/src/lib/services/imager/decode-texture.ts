import sharp from "sharp";
import type { DecodedPng } from "@/lib/services/imager/png-decode";
import { decodePng } from "@/lib/services/imager/png-decode";
import { detectNitroTextureFormat } from "@/lib/services/swf/nitro-builder";

/**
 * Decode a Nitro spritesheet texture to raw RGBA pixels.
 *
 * Every write path normalises bundles to WebP Lossless, so a PNG-only decoder
 * silently returns null for almost every bundle on disk. PNG keeps the
 * dependency-free decoder (it handles the sprite format natively and avoids a
 * native round-trip); WebP — the common case — goes through sharp.
 *
 * Throws when the bytes are neither PNG nor WebP, or when sharp cannot decode.
 */
export async function decodeTextureRgba(bytes: Buffer): Promise<DecodedPng> {
	const format = detectNitroTextureFormat(bytes);
	if (format === "png") return decodePng(bytes);
	if (format !== "webp") throw new Error("not a PNG or WebP texture");

	const { data, info } = await sharp(bytes)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	// sharp can report a colour space the spritesheet maths does not expect;
	// normalise to the 4-bytes-per-pixel RGBA that cropRgba assumes.
	if (info.channels !== 4) {
		throw new Error(`unsupported WebP channel count ${info.channels}`);
	}
	if (info.width * info.height * 4 !== data.length) {
		throw new Error("WebP texture has an inconsistent pixel buffer size");
	}

	return { width: info.width, height: info.height, rgba: data };
}
