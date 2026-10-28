import { describe, expect, it } from "vitest";
import type { SpriteImage } from "@/lib/services/swf/image-decoder";
import {
	buildSpritesheet,
	createNitroBundle,
	encodePng,
	parseNitroBundle,
} from "@/lib/services/swf/nitro-builder";
import {
	buildNitroCompressionReport,
	inspectNitroScales,
} from "./nitro-quality";

const sprite = (): SpriteImage => {
	const width = 12,
		height = 10,
		pixels = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
			pixels[o] = border ? 220 : 30;
			pixels[o + 1] = border ? 90 : 180;
			pixels[o + 2] = border ? 40 : 60;
			pixels[o + 3] = border ? 255 : 0;
		}
	}
	return { id: 0, name: "chair_0", width, height, pixels };
};

const metadata = () => ({
	name: "chair",
	spritesheet: {
		meta: { image: "chair.webp", format: "RGBA8888", size: { w: 16, h: 16 } },
		frames: { chair_0: { frame: { x: 0, y: 0, w: 12, h: 10 } } },
	},
	assets: { chair_0: { x: 0, y: 0 } },
	visualizations: [{ size: 64, animations: {} }],
});

const bundleFor = async (format: "png" | "webp") => {
	const sheet = await buildSpritesheet([sprite()], { format });
	return createNitroBundle(metadata(), sheet.texture, "chair");
};

describe("nitro compression report", () => {
	it("describes a WebP bundle and proves it is pixel-exact", async () => {
		const report = await buildNitroCompressionReport(
			parseNitroBundle(await bundleFor("webp")),
		);
		expect(report.texture.format).toBe("webp");
		expect(report.texture.fileName).toBe("chair.webp");
		expect(report.texture.lossless).toBe(true);
		// `exact: true` means not even transparent RGB is altered.
		expect(report.texture.mismatchedPixels).toBe(0);
		expect(report.texture.invisibleDifferences).toBe(0);
		expect(report.texture.spriteCount).toBe(1);
		expect(report.texture.width).toBeGreaterThan(0);
		expect(report.texture.pixels).toBe(
			report.texture.width * report.texture.height,
		);
	});

	it("breaks the bundle down into metadata, texture and container overhead", async () => {
		const parsed = parseNitroBundle(await bundleFor("webp"));
		const report = await buildNitroCompressionReport(parsed);
		expect(report.bundleBytes).toBe(parsed.bundleBytes);
		expect(report.json.compressedBytes).toBe(parsed.compressedSizes.json);
		expect(report.texture.compressedBytes).toBe(parsed.compressedSizes.texture);
		expect(report.overheadBytes).toBe(
			parsed.bundleBytes -
				parsed.compressedSizes.json -
				parsed.compressedSizes.texture,
		);
		expect(report.overheadBytes).toBeGreaterThan(0);
		// The texture is most of a small furniture bundle.
		expect(report.textureShare).toBeGreaterThan(0);
		expect(report.textureShare).toBeLessThanOrEqual(1);
		// Ratios are real savings, never zero or negative.
		expect(report.json.ratio).toBeGreaterThan(0);
		expect(report.texture.ratio).toBeGreaterThan(0);
	});

	it("shows what a legacy PNG bundle would save as WebP Lossless", async () => {
		const report = await buildNitroCompressionReport(
			parseNitroBundle(await bundleFor("png")),
		);
		expect(report.texture.format).toBe("png");
		expect(report.texture.fileName).toBe("chair.png");
		// Still verified lossless — PNG is a lossless codec too.
		expect(report.texture.mismatchedPixels).toBe(0);
		expect(report.texture.webpEstimate.bytes).toBeGreaterThan(0);
		expect(report.texture.pngEstimate.bytes).toBeGreaterThan(0);
		// The same artwork is cheaper as WebP than as PNG.
		expect(report.texture.webpEstimate.bytes).toBeLessThan(
			report.texture.pngEstimate.bytes,
		);
		expect(report.texture.webpEstimate.savingBytes).toBeGreaterThan(0);
	});

	it("keeps working for a bundle with no sprite frames", async () => {
		const png = encodePng(1, 1, Buffer.from([0, 0, 0, 0]));
		const report = await buildNitroCompressionReport(
			parseNitroBundle(createNitroBundle({ name: "empty" }, png, "empty")),
		);
		expect(report.texture.spriteCount).toBe(0);
		expect(report.texture.mismatchedPixels).toBe(0);
	});
});

describe("quality report composition", () => {
	it("leaves compression optional so existing scale consumers are unaffected", () => {
		const quality = inspectNitroScales(metadata(), 16, 16);
		expect(quality.compression).toBeUndefined();
		expect(quality.scales).toHaveLength(2);
	});
});
