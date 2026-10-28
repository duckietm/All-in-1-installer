import { describe, expect, it } from "vitest";
import { extractFurniIconPng } from "@/lib/services/clone-icon";
import { decodePng } from "@/lib/services/imager/png-decode";
import {
	createNitroBundle,
	encodePng,
	isLosslessWebp,
	parseNitroBundle,
	toWebpLosslessBundle,
} from "@/lib/services/swf/nitro-builder";

const NAME = "chair_test";
const W = 16;
const H = 16;

function makeRgba(): Buffer {
	const rgba = Buffer.alloc(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		rgba[i * 4 + 0] = 200;
		rgba[i * 4 + 1] = 40;
		rgba[i * 4 + 2] = 90;
		rgba[i * 4 + 3] = 255;
	}
	return rgba;
}

function buildBundle(texture: Buffer): Buffer {
	return createNitroBundle(
		{
			name: NAME,
			assets: { [`${NAME}_icon_a`]: { x: 0, y: 0 } },
			spritesheet: {
				frames: {
					[`${NAME}_${NAME}_icon_a`]: { frame: { x: 0, y: 0, w: W, h: H } },
				},
			},
		},
		texture,
		NAME,
	);
}

describe("extractFurniIconPng", () => {
	// Every write path normalises bundles to WebP Lossless, so a PNG-only
	// decoder made this silently return null for nearly every real bundle.
	it("extracts the icon from a PNG-textured bundle", async () => {
		const icon = await extractFurniIconPng(
			buildBundle(encodePng(W, H, makeRgba())),
		);
		expect(icon).not.toBeNull();
		expect(decodePng(icon as Buffer)).toMatchObject({ width: W, height: H });
	});

	it("extracts the icon from a WebP-lossless-textured bundle", async () => {
		const webpBundle = await toWebpLosslessBundle(
			buildBundle(encodePng(W, H, makeRgba())),
		);
		expect(isLosslessWebp(parseNitroBundle(webpBundle).texture)).toBe(true);

		const icon = await extractFurniIconPng(webpBundle);
		expect(icon).not.toBeNull();
		expect(decodePng(icon as Buffer)).toMatchObject({ width: W, height: H });
	});

	it("returns null for a bundle with no icon asset", async () => {
		const bundle = createNitroBundle(
			{ name: NAME, assets: { other: { x: 0, y: 0 } } },
			encodePng(W, H, makeRgba()),
			NAME,
		);
		expect(await extractFurniIconPng(bundle)).toBeNull();
	});

	it("returns null for bytes that are not a bundle at all", async () => {
		expect(await extractFurniIconPng(Buffer.from([1, 2, 3, 4]))).toBeNull();
	});
});
