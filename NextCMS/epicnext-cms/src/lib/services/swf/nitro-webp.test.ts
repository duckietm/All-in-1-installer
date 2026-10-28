import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { SpriteImage } from "./image-decoder";
import {
	buildSpritesheet,
	createNitroBundle,
	detectNitroTextureFormat,
	encodePng,
	encodeWebpLossless,
	isLosslessWebp,
	parseNitroBundle,
	toWebpLosslessBundle,
} from "./nitro-builder";

/**
 * Sprites shaped like real SWF DefineBitsLossless2 output: an opaque border
 * around a body whose interior is fully transparent yet still carries
 * non-zero palette RGB. That combination is what separates a genuinely
 * lossless encoder from one that quietly drops hidden colour data.
 */
function swfStyleSprite(index: number): SpriteImage {
	const width = 17 + (index % 5) * 4,
		height = 13 + (index % 3) * 6,
		pixels = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
			if (border) {
				pixels[o] = 20 + index;
				pixels[o + 1] = 140;
				pixels[o + 2] = 200;
				pixels[o + 3] = 255;
			} else {
				// Transparent, but carrying leftover palette colour.
				pixels[o] = 9 + index * 3;
				pixels[o + 1] = 77;
				pixels[o + 2] = 5;
				pixels[o + 3] = 0;
			}
		}
	}
	return { id: index, name: `chair_${index}`, width, height, pixels };
}

const sprites = () => [0, 1, 2, 3, 4].map(swfStyleSprite);

const pngHeaderOnly = () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("nitro texture format detection", () => {
	it("identifies PNG and WebP by magic bytes, not by filename", () => {
		expect(
			detectNitroTextureFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		).toBe("png");
		expect(
			detectNitroTextureFormat(
				Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8L", "latin1"),
			),
		).toBe("webp");
		expect(detectNitroTextureFormat(Buffer.from("GIF89a"))).toBeNull();
		expect(detectNitroTextureFormat(Buffer.alloc(0))).toBeNull();
		// A RIFF container that is not WebP (e.g. WAVE) must not pass.
		expect(
			detectNitroTextureFormat(
				Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt ", "latin1"),
			),
		).toBeNull();
	});
});

describe("WebP lossless encoding", () => {
	it("round-trips every texel bit-for-bit, including colour hidden under alpha 0", async () => {
		const sprite = swfStyleSprite(0);
		const encoded = await encodeWebpLossless(
			sprite.width,
			sprite.height,
			sprite.pixels,
		);
		expect(encoded.toString("ascii", 12, 16)).toBe("VP8L");
		const decoded = await sharp(encoded).raw().ensureAlpha().toBuffer();
		expect(decoded).toEqual(sprite.pixels);
	});

	it("keeps partially transparent texels exact as well", async () => {
		const pixels = Buffer.from([
			10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 1, 100, 110, 120, 254,
		]);
		const encoded = await encodeWebpLossless(4, 1, pixels);
		expect(await sharp(encoded).raw().ensureAlpha().toBuffer()).toEqual(pixels);
	});

	it("is far smaller than the equivalent PNG", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "png" });
		const webpSheet = await buildSpritesheet(sprites(), { format: "webp" });
		expect(webpSheet.texture.length).toBeLessThan(sheet.texture.length);
	});
});

describe("WebP losslessness detection", () => {
	it("confirms a VP8L image is lossless", async () => {
		const sprite = swfStyleSprite(0);
		const encoded = await encodeWebpLossless(
			sprite.width,
			sprite.height,
			sprite.pixels,
		);
		expect(isLosslessWebp(encoded)).toBe(true);
	});

	it("rejects a lossy VP8 image even though the container says WebP", async () => {
		const sprite = swfStyleSprite(0);
		const lossy = await sharp(sprite.pixels, {
			raw: { width: sprite.width, height: sprite.height, channels: 4 },
		})
			.webp({ quality: 80 })
			.toBuffer();
		// The container is still RIFF/WEBP, so only the chunk tells the truth.
		expect(detectNitroTextureFormat(lossy)).toBe("webp");
		expect(isLosslessWebp(lossy)).toBe(false);
	});

	it("is not fooled by a PNG or by a truncated header", () => {
		expect(isLosslessWebp(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
			false,
		);
		expect(isLosslessWebp(Buffer.from("RIFF"))).toBe(false);
		expect(isLosslessWebp(Buffer.alloc(0))).toBe(false);
	});

	it("reports the bytes of an empty sheet as lossless", async () => {
		const sheet = await buildSpritesheet([], { format: "webp" });
		expect(isLosslessWebp(sheet.texture)).toBe(true);
	});
});

/** Minimal Nitro JSON: one frame, enough for the container assertions. */
const metadata = (name: string) => ({
	name,
	spritesheet: {
		meta: { image: `${name}.webp`, format: "RGBA8888", size: { w: 1, h: 1 } },
		frames: { [`${name}_0`]: { frame: { x: 0, y: 0, w: 1, h: 1 } } },
	},
	assets: { [`${name}_0`]: { x: 0, y: 0 } },
});

describe("normalising a bundle to WebP Lossless", () => {
	const bundleWith = async (format: "png" | "webp", image?: string) => {
		const sheet = await buildSpritesheet(sprites(), { format });
		const meta = metadata("chair");
		meta.spritesheet.meta.image = image ?? `chair.${format}`;
		return createNitroBundle(meta, sheet.texture, "chair");
	};

	it("converts a hotel-style PNG bundle to lossless WebP", async () => {
		const before = parseNitroBundle(await bundleWith("png"));
		expect(before.textureFormat).toBe("png");
		const pngTexture = before.texture;

		const after = parseNitroBundle(
			await toWebpLosslessBundle(await bundleWith("png")),
		);
		expect(after.textureFormat).toBe("webp");
		expect(after.textureFileName).toBe("chair.webp");
		expect(
			(after.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.webp");
		expect(isLosslessWebp(after.texture)).toBe(true);
		// The artwork must be untouched by the format change.
		const decoded = await sharp(after.texture).raw().ensureAlpha().toBuffer();
		const original = await sharp(pngTexture).raw().ensureAlpha().toBuffer();
		expect(decoded).toEqual(original);
	});

	it("repairs a stale pointer while converting", async () => {
		const after = parseNitroBundle(
			await toWebpLosslessBundle(await bundleWith("png", "chair.png")),
		);
		expect(after.textureFileName).toBe("chair.webp");
		expect(
			(after.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.webp");
	});

	it("leaves an already-lossless bundle completely untouched", async () => {
		const webpBundle = await bundleWith("webp");
		await expect(toWebpLosslessBundle(webpBundle)).resolves.toBe(webpBundle);
	});

	it("is idempotent, so re-running it changes nothing", async () => {
		const once = await toWebpLosslessBundle(await bundleWith("png"));
		const twice = await toWebpLosslessBundle(once);
		expect(twice).toBe(once);
	});

	it("upgrades a lossy WebP to lossless without claiming to restore quality", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "webp" });
		const lossy = await sharp(sheet.texture).webp({ quality: 60 }).toBuffer();
		const source = createNitroBundle(metadata("chair"), lossy, "chair");
		expect(isLosslessWebp(parseNitroBundle(source).texture)).toBe(false);

		const after = parseNitroBundle(await toWebpLosslessBundle(source));
		expect(after.textureFormat).toBe("webp");
		expect(isLosslessWebp(after.texture)).toBe(true);
	});

	it("keeps the member base name of a colour variant", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "png" });
		const source = createNitroBundle(metadata("chair"), sheet.texture, "chair");
		const after = parseNitroBundle(await toWebpLosslessBundle(source));
		// A `chair*2` upload shares the `chair` library, so the member name
		// must stay based on `chair`.
		expect(after.textureFileName).toBe("chair.webp");
		expect(
			(after.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.webp");
	});

	it("rejects a bundle whose texture cannot be decoded", async () => {
		const broken = createNitroBundle(
			metadata("chair"),
			pngHeaderOnly(),
			"chair",
		);
		await expect(toWebpLosslessBundle(broken)).rejects.toThrow();
	});

	it("repairs stale meta.image in a bundle that is already lossless", async () => {
		// Already VP8L, so there is nothing to re-encode — but the pointer
		// names a member the archive does not contain, which a re-encode
		// would not be what fixes.
		const stale = await bundleWith("webp", "chair.png");
		expect(isLosslessWebp(parseNitroBundle(stale).texture)).toBe(true);

		const after = parseNitroBundle(await toWebpLosslessBundle(stale));
		expect(after.textureFileName).toBe("chair.webp");
		expect(
			(after.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.webp");
		// The existing VP8L bytes are reused rather than decoded again.
		expect(after.texture.equals(parseNitroBundle(stale).texture)).toBe(true);
	});
});

describe("spritesheet encoding", () => {
	it("defaults to WebP and reports the format it produced", async () => {
		const sheet = await buildSpritesheet(sprites());
		expect(sheet.format).toBe("webp");
		expect(detectNitroTextureFormat(sheet.texture)).toBe("webp");
		expect(sheet.frames.size).toBe(5);
	});

	it("still encodes PNG on request for legacy bundles", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "png" });
		expect(sheet.format).toBe("png");
		expect(detectNitroTextureFormat(sheet.texture)).toBe("png");
	});

	it("emits a decodable sheet whose frames hold the original pixels", async () => {
		const source = sprites();
		const sheet = await buildSpritesheet(source, { format: "webp" });
		const decoded = await sharp(sheet.texture).raw().ensureAlpha().toBuffer();
		for (const sprite of source) {
			const rect = sheet.frames.get(sprite.name);
			if (!rect) throw new Error(`frame ${sprite.name} is missing`);
			for (let y = 0; y < sprite.height; y++) {
				const from = y * sprite.width * 4;
				const to = ((rect.y + y) * sheet.width + rect.x) * 4;
				expect(decoded.subarray(to, to + sprite.width * 4)).toEqual(
					sprite.pixels.subarray(from, from + sprite.width * 4),
				);
			}
		}
	});

	it("produces a valid empty sheet rather than failing", async () => {
		const sheet = await buildSpritesheet([], { format: "webp" });
		expect(sheet.width).toBe(1);
		expect(sheet.frames.size).toBe(0);
		expect(detectNitroTextureFormat(sheet.texture)).toBe("webp");
	});
});

describe("bundle round-trip", () => {
	it("names the member after the real encoding and parses it back", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "webp" });
		const bundle = createNitroBundle(metadata("chair"), sheet.texture, "chair");
		const parsed = parseNitroBundle(bundle);
		expect(parsed.textureFileName).toBe("chair.webp");
		expect(parsed.textureFormat).toBe("webp");
		expect(parsed.texture.toString("ascii", 12, 16)).toBe("VP8L");
		// The historical aliases must keep pointing at the same bytes.
		expect(parsed.png).toEqual(parsed.texture);
		expect(parsed.pngFileName).toBe("chair.webp");
	});

	it("keeps labelling a PNG texture as .png", () => {
		const png = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
		const parsed = parseNitroBundle(
			createNitroBundle(metadata("chair"), png, "chair"),
		);
		expect(parsed.textureFileName).toBe("chair.png");
		expect(parsed.textureFormat).toBe("png");
	});

	it("reports the member sizes the compression report relies on", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "webp" });
		const bundle = createNitroBundle(metadata("chair"), sheet.texture, "chair");
		const parsed = parseNitroBundle(bundle);
		expect(parsed.compressedSizes.texture).toBeGreaterThan(0);
		expect(parsed.compressedSizes.json).toBeGreaterThan(0);
		expect(parsed.bundleBytes).toBe(bundle.length);
		// Overhead is the container framing, so members must fit inside it.
		expect(
			parsed.compressedSizes.json + parsed.compressedSizes.texture,
		).toBeLessThan(parsed.bundleBytes);
	});

	it("repairs a stale .png pointer instead of writing an inconsistent bundle", async () => {
		const sheet = await buildSpritesheet(sprites(), { format: "webp" });
		// A studio metadata edit can leave the old pointer behind while the
		// texture itself stays WebP; the client would then look for a member
		// that is not in the bundle.
		const stale = metadata("chair");
		stale.spritesheet.meta.image = "chair.png";
		const parsed = parseNitroBundle(
			createNitroBundle(stale, sheet.texture, "chair"),
		);
		expect(parsed.textureFileName).toBe("chair.webp");
		expect(
			(parsed.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.webp");
		// The caller's object must not be mutated in place.
		expect(stale.spritesheet.meta.image).toBe("chair.png");
	});

	it("leaves a matching pointer and the rest of the metadata alone", () => {
		const png = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
		const parsed = parseNitroBundle(
			createNitroBundle(metadata("chair"), png, "chair"),
		);
		expect(
			(parsed.json.spritesheet as { meta: { image: string } }).meta.image,
		).toBe("chair.png");
		expect(
			(parsed.json.spritesheet as { frames: Record<string, unknown> }).frames,
		).toEqual({ chair_0: { frame: { x: 0, y: 0, w: 1, h: 1 } } });
	});

	it("tolerates metadata that has no spritesheet at all", () => {
		const png = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
		const parsed = parseNitroBundle(
			createNitroBundle({ name: "bare" }, png, "bare"),
		);
		expect(parsed.textureFileName).toBe("bare.png");
		expect(parsed.json.name).toBe("bare");
	});

	it("rejects a bundle whose texture is neither PNG nor WebP", () => {
		const good = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
		expect(() =>
			createNitroBundle(metadata("chair"), Buffer.from("GIF89a"), "chair"),
		).toThrow(/PNG or WebP/);
		// Sanity: the valid case still builds.
		expect(
			createNitroBundle(metadata("chair"), good, "chair").length,
		).toBeGreaterThan(0);
	});
});
