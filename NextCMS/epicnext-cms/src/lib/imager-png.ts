import "server-only";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Whether a buffer is an animated PNG (APNG).
 *
 * APNG is a PNG carrying an `acTL` control chunk before `IDAT`; a plain PNG has
 * none. `sharp`/libvips in this build cannot decode APNG *animation* — it reads
 * only the first frame and re-encodes that — so a WebP/AVIF transcode of an
 * APNG silently turns a moving avatar into a still one. Callers that care about
 * quality use this to leave animated renders untouched and only re-encode the
 * static ones. Chunk walking stops at `IDAT`/`IEND` because the spec requires
 * `acTL` to precede them.
 */
export function isAnimatedPng(bytes: Uint8Array): boolean {
	if (bytes.length < 8) return false;
	for (let i = 0; i < 8; i++) {
		if (bytes[i] !== PNG_SIGNATURE[i]) return false;
	}

	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length =
			((bytes[offset] << 24) |
				(bytes[offset + 1] << 16) |
				(bytes[offset + 2] << 8) |
				bytes[offset + 3]) >>>
			0;
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7],
		);
		if (type === "acTL") return true;
		if (type === "IDAT" || type === "IEND") return false;
		// A corrupt length would loop forever; bail instead.
		if (length > bytes.length) return false;
		offset += 12 + length;
	}
	return false;
}
