import { inflateSync } from "node:zlib";
import * as jpeg from "jpeg-js";

export interface SpriteImage {
	id: number;
	name: string;
	width: number;
	height: number;
	pixels: Buffer; // RGBA
}

// ── DefineBitsLossless2 Parser (with alpha) ──────────────────────

export function parseBitsLossless2(data: Buffer): {
	id: number;
	width: number;
	height: number;
	pixels: Buffer;
} {
	let offset = 0;
	const id = data.readUInt16LE(offset);
	offset += 2;
	const format = data.readUInt8(offset);
	offset += 1;
	const width = data.readUInt16LE(offset);
	offset += 2;
	const height = data.readUInt16LE(offset);
	offset += 2;

	let colorTableSize = 0;
	if (format === 3) {
		colorTableSize = data.readUInt8(offset) + 1;
		offset += 1;
	}

	const compressed = data.subarray(offset);
	let decompressed: Buffer;
	try {
		decompressed = inflateSync(compressed);
	} catch {
		return { id, width, height, pixels: Buffer.alloc(width * height * 4) };
	}

	const pixels = Buffer.alloc(width * height * 4);

	if (format === 5) {
		let srcOff = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (srcOff + 3 >= decompressed.length) break;
				const a = decompressed[srcOff];
				let r = decompressed[srcOff + 1];
				let g = decompressed[srcOff + 2];
				let b = decompressed[srcOff + 3];
				srcOff += 4;

				// Un-premultiply alpha
				if (a > 0 && a < 255) {
					r = Math.min(255, Math.round((r * 255) / a));
					g = Math.min(255, Math.round((g * 255) / a));
					b = Math.min(255, Math.round((b * 255) / a));
				}

				const dstOff = (y * width + x) * 4;
				pixels[dstOff] = r;
				pixels[dstOff + 1] = g;
				pixels[dstOff + 2] = b;
				pixels[dstOff + 3] = a;
			}
		}
	} else if (format === 3) {
		const palette: number[][] = [];
		let palOff = 0;
		for (let i = 0; i < colorTableSize; i++) {
			const a = decompressed[palOff];
			let r = decompressed[palOff + 1];
			let g = decompressed[palOff + 2];
			let b = decompressed[palOff + 3];
			// Un-premultiply alpha for palette entries (same as format 5)
			if (a > 0 && a < 255) {
				r = Math.min(255, Math.round((r * 255) / a));
				g = Math.min(255, Math.round((g * 255) / a));
				b = Math.min(255, Math.round((b * 255) / a));
			}
			palette.push([r, g, b, a]);
			palOff += 4;
		}

		const rowPadded = Math.ceil(width / 4) * 4;
		let srcOff = colorTableSize * 4;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = decompressed[srcOff + x];
				const color = palette[idx] || [0, 0, 0, 0];
				const dstOff = (y * width + x) * 4;
				pixels[dstOff] = color[0];
				pixels[dstOff + 1] = color[1];
				pixels[dstOff + 2] = color[2];
				pixels[dstOff + 3] = color[3];
			}
			srcOff += rowPadded;
		}
	}

	return { id, width, height, pixels };
}

// ── DefineBitsLossless Parser (without alpha) ──────────────────────

export function parseBitsLossless(data: Buffer): {
	id: number;
	width: number;
	height: number;
	pixels: Buffer;
} {
	let offset = 0;
	const id = data.readUInt16LE(offset);
	offset += 2;
	const format = data.readUInt8(offset);
	offset += 1;
	const width = data.readUInt16LE(offset);
	offset += 2;
	const height = data.readUInt16LE(offset);
	offset += 2;

	let colorTableSize = 0;
	if (format === 3) {
		colorTableSize = data.readUInt8(offset) + 1;
		offset += 1;
	}

	const compressed = data.subarray(offset);
	let decompressed: Buffer;
	try {
		decompressed = inflateSync(compressed);
	} catch {
		return { id, width, height, pixels: Buffer.alloc(width * height * 4) };
	}

	const pixels = Buffer.alloc(width * height * 4);

	if (format === 5) {
		let srcOff = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (srcOff + 3 >= decompressed.length) break;
				srcOff++; // skip padding byte
				const r = decompressed[srcOff++];
				const g = decompressed[srcOff++];
				const b = decompressed[srcOff++];
				const dstOff = (y * width + x) * 4;
				pixels[dstOff] = r;
				pixels[dstOff + 1] = g;
				pixels[dstOff + 2] = b;
				pixels[dstOff + 3] = 255;
			}
		}
	} else if (format === 3) {
		const palette: number[][] = [];
		let palOff = 0;
		for (let i = 0; i < colorTableSize; i++) {
			const r = decompressed[palOff];
			const g = decompressed[palOff + 1];
			const b = decompressed[palOff + 2];
			palette.push([r, g, b, 255]);
			palOff += 3;
		}

		const rowPadded = Math.ceil(width / 4) * 4;
		let srcOff = colorTableSize * 3;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = decompressed[srcOff + x];
				const color = palette[idx] || [0, 0, 0, 255];
				const dstOff = (y * width + x) * 4;
				pixels[dstOff] = color[0];
				pixels[dstOff + 1] = color[1];
				pixels[dstOff + 2] = color[2];
				pixels[dstOff + 3] = color[3];
			}
			srcOff += rowPadded;
		}
	}

	return { id, width, height, pixels };
}

// ── DefineBitsJpeg2 Parser (JPEG without alpha) ───────────────────

export function parseBitsJpeg2(
	data: Buffer,
): { id: number; width: number; height: number; pixels: Buffer } | null {
	if (data.length < 6) return null;

	const id = data.readUInt16LE(0);
	let jpegData = data.subarray(2);

	// Strip erroneous JPEG header (FF D9 FF D1) if present
	if (
		jpegData.length >= 4 &&
		jpegData[0] === 0xff &&
		jpegData[1] === 0xd9 &&
		jpegData[2] === 0xff &&
		jpegData[3] === 0xd1
	) {
		jpegData = jpegData.subarray(4);
	}

	const dims = parseJpegDimensions(jpegData);
	if (!dims) return null;

	const pixels = decodeJpegToRGBA(jpegData, dims.width, dims.height);
	return { id, width: dims.width, height: dims.height, pixels };
}

// ── DefineBitsJpeg3 Parser (JPEG with alpha channel) ──────────────

export function parseBitsJpeg3(
	data: Buffer,
): { id: number; width: number; height: number; pixels: Buffer } | null {
	if (data.length < 6) return null;

	const id = data.readUInt16LE(0);
	const alphaDataOffset = data.readUInt32LE(2);
	let jpegData = data.subarray(6, 6 + alphaDataOffset);

	// Strip erroneous JPEG header (FF D9 FF D1) if present
	if (
		jpegData.length >= 4 &&
		jpegData[0] === 0xff &&
		jpegData[1] === 0xd9 &&
		jpegData[2] === 0xff &&
		jpegData[3] === 0xd1
	) {
		jpegData = jpegData.subarray(4);
	}

	const dims = parseJpegDimensions(jpegData);
	if (!dims) return null;

	const pixels = decodeJpegToRGBA(jpegData, dims.width, dims.height);

	// Apply zlib-compressed alpha channel
	const compressedAlpha = data.subarray(6 + alphaDataOffset);
	if (compressedAlpha.length > 0) {
		try {
			const alpha = inflateSync(compressedAlpha);
			const pixelCount = dims.width * dims.height;
			for (let i = 0; i < pixelCount && i < alpha.length; i++) {
				pixels[i * 4 + 3] = alpha[i];
			}
		} catch {
			// Alpha decompression failed, keep fully opaque
		}
	}

	return { id, width: dims.width, height: dims.height, pixels };
}

// ── JPEG Dimension Parser (reads SOF0/SOF2 markers) ───────────────

export function parseJpegDimensions(
	jpeg: Buffer,
): { width: number; height: number } | null {
	let offset = 0;
	while (offset < jpeg.length - 1) {
		if (jpeg[offset] !== 0xff) {
			offset++;
			continue;
		}

		const marker = jpeg[offset + 1];
		offset += 2;

		// SOF0 (Baseline), SOF1 (Extended), SOF2 (Progressive)
		if (marker >= 0xc0 && marker <= 0xc2) {
			if (offset + 7 > jpeg.length) return null;
			// Skip length (2 bytes) + precision (1 byte)
			const height = jpeg.readUInt16BE(offset + 3);
			const width = jpeg.readUInt16BE(offset + 5);
			return { width, height };
		}

		// Skip non-SOF markers with length field
		if (marker === 0xd8 || marker === 0xd9) continue; // SOI / EOI
		if (marker >= 0xd0 && marker <= 0xd7) continue; // RST markers
		if (offset + 2 > jpeg.length) break;
		const segLen = jpeg.readUInt16BE(offset);
		offset += segLen;
	}
	return null;
}

// ── JPEG to RGBA decoder using jpeg-js ──────────────────────────────

export function decodeJpegToRGBA(
	jpegData: Buffer,
	width: number,
	height: number,
): Buffer {
	try {
		const decoded = jpeg.decode(jpegData, {
			useTArray: true,
			formatAsRGBA: true,
		});
		// jpeg-js returns RGBA data directly
		return Buffer.from(
			decoded.data.buffer,
			decoded.data.byteOffset,
			decoded.data.byteLength,
		);
	} catch {
		// Fallback: transparent pixels if JPEG decode fails
		return Buffer.alloc(width * height * 4);
	}
}
