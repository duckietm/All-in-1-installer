import { inflateSync } from "node:zlib";

export interface DecodedPng {
	width: number;
	height: number;
	/** RGBA8888, row-major, length = width * height * 4 */
	rgba: Buffer;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

function unfilter(
	filter: number,
	cur: Buffer,
	prev: Buffer,
	bpp: number,
): void {
	const n = cur.length;
	switch (filter) {
		case 0:
			break;
		case 1:
			for (let i = 0; i < n; i++)
				cur[i] = (cur[i] + (i >= bpp ? cur[i - bpp] : 0)) & 0xff;
			break;
		case 2:
			for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
			break;
		case 3:
			for (let i = 0; i < n; i++) {
				const a = i >= bpp ? cur[i - bpp] : 0;
				cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff;
			}
			break;
		case 4:
			for (let i = 0; i < n; i++) {
				const a = i >= bpp ? cur[i - bpp] : 0;
				const c = i >= bpp ? prev[i - bpp] : 0;
				cur[i] = (cur[i] + paeth(a, prev[i], c)) & 0xff;
			}
			break;
		default:
			throw new Error(`unknown PNG filter ${filter}`);
	}
}

/**
 * Minimal PNG decoder for 8-bit non-interlaced images (color type 6/RGBA,
 * 2/RGB, 0/grayscale). Enough to read Nitro spritesheet PNGs (RGBA8888).
 * Returns RGBA pixels. Throws on unsupported formats.
 */
export function decodePng(buf: Buffer): DecodedPng {
	if (
		buf.length < 8 ||
		buf[0] !== 0x89 ||
		buf[1] !== 0x50 ||
		buf[2] !== 0x4e ||
		buf[3] !== 0x47
	) {
		throw new Error("not a PNG");
	}
	let off = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let interlace = 0;
	const idat: Buffer[] = [];
	while (off + 8 <= buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString("ascii", off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		off += 12 + len; // length(4) + type(4) + data + crc(4)
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			break;
		}
	}
	if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
	if (interlace !== 0) throw new Error("interlaced PNG not supported");
	const channels =
		colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
	if (channels === -1)
		throw new Error(`unsupported PNG color type ${colorType}`);

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const planar = Buffer.alloc(height * stride);
	let prev = Buffer.alloc(stride);
	let rp = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[rp++];
		const cur = planar.subarray(y * stride, y * stride + stride);
		raw.copy(cur, 0, rp, rp + stride);
		rp += stride;
		unfilter(filter, cur, prev, channels);
		prev = cur;
	}

	if (channels === 4) return { width, height, rgba: planar };

	const rgba = Buffer.alloc(width * height * 4);
	for (let i = 0, j = 0; i < width * height; i++) {
		if (channels === 3) {
			rgba[j++] = planar[i * 3];
			rgba[j++] = planar[i * 3 + 1];
			rgba[j++] = planar[i * 3 + 2];
		} else {
			const g = planar[i];
			rgba[j++] = g;
			rgba[j++] = g;
			rgba[j++] = g;
		}
		rgba[j++] = 255;
	}
	return { width, height, rgba };
}

/** Crop a w×h RGBA region at (x,y) out of a sheetW-wide RGBA buffer. */
export function cropRgba(
	rgba: Buffer,
	sheetW: number,
	x: number,
	y: number,
	w: number,
	h: number,
): Buffer {
	const out = Buffer.alloc(w * h * 4);
	for (let row = 0; row < h; row++) {
		const src = ((y + row) * sheetW + x) * 4;
		rgba.copy(out, row * w * 4, src, src + w * 4);
	}
	return out;
}
