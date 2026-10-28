import { deflateSync, gunzipSync, inflateSync } from "node:zlib";
import sharp from "sharp";
import type { SpriteImage } from "./image-decoder";

// ── Texture Formats ────────────────────────────────────────────────

/**
 * Image formats a `.nitro` bundle may carry as its spritesheet texture.
 *
 * `webp` is the default for newly converted bundles: VP8L is a true lossless
 * codec, so pixels round-trip bit-for-bit (bar RGB under fully transparent
 * pixels, which no renderer can observe) while typically weighing 25-40% of the
 * equivalent PNG. `png` stays supported so existing bundles, official Habbo
 * gamedata and the PNG-icon sidecar keep parsing unchanged.
 */
export type NitroTextureFormat = "png" | "webp";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Identify a Nitro texture by its magic bytes rather than by its filename, so
 * the container writer can never label an image with the wrong extension.
 * Returns `null` for anything that is not a PNG or a RIFF/WEBP image.
 */
export function detectNitroTextureFormat(
	bytes: Buffer,
): NitroTextureFormat | null {
	// PNG is identified by its 8-byte signature; WebP additionally needs room
	// for the "RIFF" size and the "WEBP" fourcc at offset 8.
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE))
		return "png";
	if (
		bytes.length >= 12 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	)
		return "webp";
	return null;
}

/** Human-readable, used by validation error messages. */
export const NITRO_TEXTURE_LABEL: Record<NitroTextureFormat, string> = {
	png: "PNG",
	webp: "WebP",
};

/**
 * A RIFF container can also hold a lossy VP8 image, so "this is a WebP" is
 * not the same claim as "this is WebP Lossless". The verdict comes from the
 * image chunk: `VP8L` is lossless, `VP8 ` is lossy, and `VP8X` is only an
 * extended header that defers the answer to a later chunk, so the container
 * is walked rather than guessed at.
 */
export function isLosslessWebp(bytes: Buffer): boolean {
	if (detectNitroTextureFormat(bytes) !== "webp") return false;
	// RIFF size covers everything after the first 8 bytes; clamp it so a
	// truncated file cannot make us read past the buffer.
	const declared = bytes.readUInt32LE(4) + 8;
	const end = Math.min(declared, bytes.length);
	let sawLossy = false;
	for (let at = 12; at + 8 <= end; ) {
		const fourcc = bytes.toString("ascii", at, at + 4);
		// Chunk payloads are padded to an even length.
		const size = bytes.readUInt32LE(at + 4);
		if (fourcc === "VP8L") return !sawLossy;
		if (fourcc === "VP8 ") sawLossy = true;
		at += 8 + size + (size % 2);
	}
	return false;
}

// ── Minimal PNG Encoder ────────────────────────────────────────────

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c;
	}
	return table;
})();

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const buf = Buffer.alloc(4 + 4 + data.length + 4);
	buf.writeUInt32BE(data.length, 0);
	buf.write(type, 4, 4, "ascii");
	data.copy(buf, 8);
	const crc = crc32(buf.subarray(4, 8 + data.length));
	buf.writeUInt32BE(crc >>> 0, 8 + data.length);
	return buf;
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
	const rawData = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		const rowStart = y * (1 + width * 4);
		rawData[rowStart] = 0; // filter: None
		rgba.copy(rawData, rowStart + 1, y * width * 4, (y + 1) * width * 4);
	}

	const compressed = deflateSync(rawData);

	const chunks: Buffer[] = [];

	// Signature
	chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

	// IHDR
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace
	chunks.push(pngChunk("IHDR", ihdr));

	// IDAT
	chunks.push(pngChunk("IDAT", compressed));

	// IEND
	chunks.push(pngChunk("IEND", Buffer.alloc(0)));

	return Buffer.concat(chunks);
}

// ── WebP Lossless Encoder ──────────────────────────────────────────

/**
 * Encode RGBA pixels as a WebP image using the VP8L lossless codec.
 *
 * `lossless: true` is what keeps furniture artwork pixel-exact; the remaining
 * options are pinned so no chroma-subsampling or near-lossless approximation
 * can creep in. `effort: 6` is libvips' slowest-but-best setting, which is
 * worth it for a one-off import and keeps spritesheets compact.
 *
 * `exact: true` (libvips' "preserve the colour data in transparent pixels")
 * mirrors ImageSharp's `TransparentColorMode.Preserve`, so a bundle converts
 * without a single altered texel — not even the RGB hidden under alpha 0.
 * It costs bytes whenever transparent areas carry non-uniform colour, so the
 * studio compression report states the size either way.
 */
export async function encodeWebpLossless(
	width: number,
	height: number,
	rgba: Buffer,
	options?: { exact?: boolean },
): Promise<Buffer> {
	return sharp(rgba, { raw: { width, height, channels: 4 } })
		.webp({
			lossless: true,
			nearLossless: false,
			smartSubsample: false,
			effort: 6,
			exact: options?.exact ?? true,
		})
		.toBuffer();
}

// ── Bin-Packing Spritesheet Builder ────────────────────────────────

interface PackedRect {
	x: number;
	y: number;
	w: number;
	h: number;
	name: string;
}

function nextPow2(v: number): number {
	v--;
	v |= v >> 1;
	v |= v >> 2;
	v |= v >> 4;
	v |= v >> 8;
	v |= v >> 16;
	return v + 1;
}

/**
 * Simple shelf-based bin packing algorithm.
 * Sorts sprites by height descending, then packs left-to-right in rows.
 * Produces much tighter spritesheets than simple vertical stacking.
 */
function binPack(images: SpriteImage[]): {
	rects: PackedRect[];
	width: number;
	height: number;
} {
	if (images.length === 0) {
		return { rects: [], width: 1, height: 1 };
	}

	// Sort by height descending for better shelf packing
	const sorted = [...images].sort(
		(a, b) => b.height - a.height || b.width - a.width,
	);

	// Estimate initial atlas width based on total area
	const totalArea = sorted.reduce(
		(sum, img) => sum + img.width * img.height,
		0,
	);
	const maxSingleWidth = Math.max(...sorted.map((i) => i.width));
	let atlasWidth = Math.max(maxSingleWidth, Math.ceil(Math.sqrt(totalArea)));

	// Round up to power of 2 for GPU friendliness (max 2048)
	atlasWidth = Math.min(2048, nextPow2(atlasWidth));

	const rects: PackedRect[] = [];
	let shelfY = 0;
	let shelfHeight = 0;
	let shelfX = 0;

	for (const img of sorted) {
		// If sprite doesn't fit on current shelf, start new shelf
		if (shelfX + img.width > atlasWidth) {
			shelfY += shelfHeight;
			shelfHeight = 0;
			shelfX = 0;
		}

		rects.push({
			x: shelfX,
			y: shelfY,
			w: img.width,
			h: img.height,
			name: img.name,
		});
		shelfX += img.width;
		shelfHeight = Math.max(shelfHeight, img.height);
	}

	const finalHeight = shelfY + shelfHeight;
	return { rects, width: atlasWidth, height: finalHeight || 1 };
}

// ── Spritesheet Builder ────────────────────────────────────────────

interface FrameInfo {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Spritesheet {
	/** Encoded texture bytes, in `format`. */
	texture: Buffer;
	format: NitroTextureFormat;
	frames: Map<string, FrameInfo>;
	width: number;
	height: number;
}

export async function buildSpritesheet(
	images: SpriteImage[],
	options?: { format?: NitroTextureFormat },
): Promise<Spritesheet> {
	const format = options?.format ?? "webp";
	const encode = async (
		width: number,
		height: number,
		rgba: Buffer,
	): Promise<Buffer> =>
		format === "webp"
			? await encodeWebpLossless(width, height, rgba)
			: encodePng(width, height, rgba);

	if (images.length === 0) {
		return {
			texture: await encode(1, 1, Buffer.alloc(4)),
			format,
			frames: new Map(),
			width: 1,
			height: 1,
		};
	}

	const { rects, width: sheetWidth, height: sheetHeight } = binPack(images);

	// Build lookup by name for pixel data
	const imageByName = new Map(images.map((img) => [img.name, img]));

	const combined = Buffer.alloc(sheetWidth * sheetHeight * 4);
	const frames = new Map<string, FrameInfo>();

	for (const rect of rects) {
		const img = imageByName.get(rect.name);
		if (!img) continue;

		// Copy pixels row by row
		for (let y = 0; y < img.height; y++) {
			const srcStart = y * img.width * 4;
			const dstStart = ((rect.y + y) * sheetWidth + rect.x) * 4;
			img.pixels.copy(combined, dstStart, srcStart, srcStart + img.width * 4);
		}
		frames.set(rect.name, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
	}

	const texture = await encode(sheetWidth, sheetHeight, combined);
	return { texture, format, frames, width: sheetWidth, height: sheetHeight };
}

// ── .nitro Bundle Creator ──────────────────────────────────────────

/**
 * The client resolves the spritesheet through `spritesheet.meta.image`, so
 * that pointer has to name the member we actually write. Editing metadata in
 * the studio can leave a stale `chair.png` behind, and a bundle whose JSON
 * disagrees with its own member list silently renders nothing — so the
 * pointer is corrected here, at the single point where bytes are written,
 * rather than trusting every call site to remember. The input is not mutated.
 */
function withTexturePointer(json: object, textureFileName: string): object {
	const record = json as Record<string, unknown>;
	const spritesheet = record.spritesheet as Record<string, unknown> | undefined;
	const meta = spritesheet?.meta as Record<string, unknown> | undefined;
	if (!meta || meta.image === textureFileName) return json;
	return {
		...record,
		spritesheet: { ...spritesheet, meta: { ...meta, image: textureFileName } },
	};
}

export function createNitroBundle(
	jsonData: object,
	textureData: Buffer,
	name: string,
): Buffer {
	// Label the member by what the bytes actually are, never by a caller's
	// assumption, so `parseNitroBundle` and the client both resolve the right
	// extension.
	const detected = detectNitroTextureFormat(textureData);
	if (!detected)
		throw Error(
			"Nitro texture must be a PNG or WebP image; the client renderer supports no other format",
		);

	const jsonFileName = `${name}.json`;
	const textureFileName = `${name}.${detected}`;

	const jsonStr = JSON.stringify(withTexturePointer(jsonData, textureFileName));
	const jsonCompressed = deflateSync(Buffer.from(jsonStr, "utf-8"));
	// The texture arrives already compressed by its own codec (WebP/VP8L or
	// PNG/DEFLATE), so this layer is mostly a no-op pass-through; it stays
	// because the container format mandates it and readers inflate it.
	const textureCompressed = deflateSync(textureData);

	const totalSize =
		2 +
		(2 + jsonFileName.length + 4 + jsonCompressed.length) +
		(2 + textureFileName.length + 4 + textureCompressed.length);

	const bundle = Buffer.alloc(totalSize);
	let offset = 0;

	bundle.writeInt16BE(2, offset);
	offset += 2;

	bundle.writeInt16BE(jsonFileName.length, offset);
	offset += 2;
	bundle.write(jsonFileName, offset, jsonFileName.length, "utf-8");
	offset += jsonFileName.length;
	bundle.writeInt32BE(jsonCompressed.length, offset);
	offset += 4;
	jsonCompressed.copy(bundle, offset);
	offset += jsonCompressed.length;

	bundle.writeInt16BE(textureFileName.length, offset);
	offset += 2;
	bundle.write(textureFileName, offset, textureFileName.length, "utf-8");
	offset += textureFileName.length;
	bundle.writeInt32BE(textureCompressed.length, offset);
	offset += 4;
	textureCompressed.copy(bundle, offset);

	return bundle;
}

// ── .nitro Bundle Parser ──────────────────────────────────────────

export interface ParsedNitroBundle {
	json: Record<string, unknown>;
	jsonFileName: string;
	/** Decoded spritesheet bytes. WebP or PNG — sniff the format, don't assume. */
	texture: Buffer;
	textureFileName: string;
	/** Format of `texture`, taken from its filename. */
	textureFormat: NitroTextureFormat;
	/**
	 * @deprecated Historical name for `texture`. Kept so existing callers and
	 * the emitted client payload stay compatible; the bytes are format-agnostic.
	 */
	png: Buffer;
	/** @deprecated Historical name for `textureFileName`. */
	pngFileName: string;
	/** Deflated byte length of each member, as stored in the container. */
	compressedSizes: { json: number; texture: number };
	/** Size of the container itself, in bytes. */
	bundleBytes: number;
}

/**
 * Parse a `.nitro` bundle.
 *
 * The container stores a filename per member, so the texture format is read
 * from that name and cross-checked against the bytes. Both PNG and WebP
 * textures parse; anything else is rejected rather than handed downstream as
 * an undecodable image.
 */
export function parseNitroBundle(
	buffer: Buffer,
	options?: { maxOutputLength?: number },
): ParsedNitroBundle {
	let offset = 0;

	const fileCount = buffer.readInt16BE(offset);
	offset += 2;
	if (fileCount < 2) {
		throw new Error(
			`Expected at least 2 files in .nitro bundle, got ${fileCount}`,
		);
	}

	// File 1: JSON
	const jsonFileNameLen = buffer.readInt16BE(offset);
	offset += 2;
	const jsonFileName = buffer.toString(
		"utf-8",
		offset,
		offset + jsonFileNameLen,
	);
	offset += jsonFileNameLen;
	const jsonCompressedLen = buffer.readInt32BE(offset);
	offset += 4;
	const jsonCompressed = buffer.subarray(offset, offset + jsonCompressedLen);
	offset += jsonCompressedLen;
	const jsonStr = inflateJsonOrGzip(jsonCompressed, options).toString("utf-8");
	const json = JSON.parse(jsonStr);

	// File 2: texture (PNG or WebP)
	const textureFileNameLen = buffer.readInt16BE(offset);
	offset += 2;
	const textureFileName = buffer.toString(
		"utf-8",
		offset,
		offset + textureFileNameLen,
	);
	offset += textureFileNameLen;
	const textureCompressedLen = buffer.readInt32BE(offset);
	offset += 4;
	const textureCompressed = buffer.subarray(
		offset,
		offset + textureCompressedLen,
	);
	offset += textureCompressedLen;
	const texture = inflateJsonOrGzip(textureCompressed, options);

	const textureFormat = detectNitroTextureFormat(texture);
	if (!textureFormat)
		throw new Error(
			`Unsupported .nitro texture "${textureFileName}": expected a PNG or WebP image`,
		);

	return {
		json,
		jsonFileName,
		texture,
		textureFileName,
		textureFormat,
		png: texture,
		pngFileName: textureFileName,
		compressedSizes: { json: jsonCompressedLen, texture: textureCompressedLen },
		bundleBytes: buffer.length,
	};
}

/**
 * Some bundled .nitro files (e.g. official /var/www/gamedata furniture)
 * gzip their contents instead of raw-deflate. Try inflate first, then fall
 * back to gunzip so both formats parse.
 */
function inflateJsonOrGzip(
	input: Buffer,
	options?: { maxOutputLength?: number },
): Buffer {
	try {
		return inflateSync(input, options);
	} catch {
		return gunzipSync(input, options);
	}
}

// ── WebP Lossless Normalisation ────────────────────────────────────

/**
 * Return the bundle with its texture stored as WebP Lossless (VP8L).
 *
 * Studio imports should all look the same regardless of where the bytes
 * came from: a hotel serves PNG, a hand-made bundle may carry anything, and
 * an SWF import already produces WebP. Re-encoding here means one code path
 * decides the format instead of each importer deciding on its own.
 *
 * The texture is decoded and re-encoded with `encodeWebpLossless`, so it
 * round-trips bit-for-bit, and the member keeps the base name it arrived
 * with — a `chair*2` colour variant sharing the `chair` library must not be
 * renamed. `meta.image` is corrected by `createNitroBundle`.
 *
 * A bundle that is already lossless WebP is returned untouched, which keeps
 * the operation idempotent and avoids a pointless re-encode — but only when
 * its metadata is already consistent. A bundle whose `meta.image` names a
 * member that is not in the file is still rebuilt, because a client that
 * cannot find the texture renders nothing and a re-encode is not what fixes
 * that.
 *
 * Throws if the texture claims to be PNG or WebP but cannot actually be
 * decoded; callers that would rather keep the original should catch.
 */
export async function toWebpLosslessBundle(bundle: Buffer): Promise<Buffer> {
	const parsed = parseNitroBundle(bundle);
	const meta = (parsed.json as { spritesheet?: { meta?: { image?: string } } })
		.spritesheet?.meta;
	if (isLosslessWebp(parsed.texture)) {
		if (meta?.image === parsed.textureFileName) return bundle;
		// Stale metadata only: rebuild the archive with the pointer corrected
		// and reuse the existing VP8L bytes rather than re-encoding them.
		return createNitroBundle(
			parsed.json,
			parsed.texture,
			parsed.textureFileName.replace(/\.(?:png|webp)$/i, ""),
		);
	}

	const image = sharp(parsed.texture);
	const { width = 0, height = 0 } = await image.metadata();
	if (!width || !height)
		throw new Error(
			`Nitro texture "${parsed.textureFileName}" has no readable dimensions`,
		);

	const webp = await encodeWebpLossless(
		width,
		height,
		await image.raw().ensureAlpha().toBuffer(),
	);
	const memberBase = parsed.textureFileName.replace(/\.(?:png|webp)$/i, "");
	return createNitroBundle(parsed.json, webp, memberBase);
}
