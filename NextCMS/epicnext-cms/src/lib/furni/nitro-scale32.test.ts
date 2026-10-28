import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
	createNitroBundle,
	parseNitroBundle,
} from "@/lib/services/swf/nitro-builder";
import { generateScale32 } from "./nitro-scale32";

const metadata = () => ({
	name: "chair",
	assets: {
		chair_64_a_0_0: { x: -5, y: 7 },
		chair_64_a_2_0: { source: "chair_64_a_0_0", x: 5, y: 7, flipH: true },
	},
	visualizations: [
		{
			size: 64,
			layerCount: 1,
			layers: { 0: { x: 6, y: -4, z: 3 } },
			animations: {
				0: {
					layers: {
						0: {
							frameRepeat: 4,
							frameSequences: {
								0: { frames: { 0: { id: 0, x: 6, y: 4, randomX: 8 } } },
							},
						},
					},
				},
			},
		},
	],
	logic: { model: { dimensions: { x: 2, y: 1, z: 1 } } },
	spritesheet: {
		frames: {
			chair_64_a_0_0: {
				frame: { x: 0, y: 0, w: 6, h: 8 },
				rotated: false,
				trimmed: false,
				spriteSourceSize: { x: 0, y: 0, w: 6, h: 8 },
				sourceSize: { w: 6, h: 8 },
			},
		},
		meta: { size: { w: 6, h: 8 }, scale: "1" },
	},
});
async function bundle(json = metadata()) {
	return createNitroBundle(
		json,
		await sharp({
			create: { width: 6, height: 8, channels: 4, background: "#ff0000" },
		})
			.png()
			.toBuffer(),
		"chair",
	);
}
describe("scale 32 generation", () => {
	it("preserves originals and adds half-size artwork and offsets without changing timing or geometry", async () => {
		const source = await bundle();
		const result = await generateScale32(source);
		const { json, png } = parseNitroBundle(result.bundle);
		const m = json as ReturnType<typeof metadata>;
		expect(m.assets.chair_64_a_0_0).toEqual(metadata().assets.chair_64_a_0_0);
		expect(m.logic).toEqual(metadata().logic);
		expect(
			(json.assets as Record<string, unknown>).chair_32_a_0_0,
		).toMatchObject({ x: -2, y: 4 });
		expect(
			(json.assets as Record<string, unknown>).chair_32_a_2_0,
		).toMatchObject({
			source: "chair_32_a_0_0",
			flipH: true,
		});
		expect(
			(json.spritesheet as { frames: Record<string, { frame: unknown }> })
				.frames.chair_32_a_0_0.frame,
		).toMatchObject({ w: 3, h: 4 });
		expect(m.visualizations[1]).toMatchObject({
			size: 32,
			layers: { 0: { x: 3, y: -2, z: 3 } },
			animations: {
				0: {
					layers: {
						0: {
							frameRepeat: 4,
							frameSequences: {
								0: { frames: { 0: { id: 0, x: 3, y: 2, randomX: 4 } } },
							},
						},
					},
				},
			},
		});
		expect(
			await sharp(png)
				.extract({ left: 0, top: 0, width: 6, height: 8 })
				.raw()
				.toBuffer(),
		).toEqual(await sharp(parseNitroBundle(source).png).raw().toBuffer());
	});
	it("never overwrites a native or partial scale32", async () => {
		const m = metadata();
		m.visualizations.push({ ...m.visualizations[0], size: 32 });
		await expect(generateScale32(await bundle(m))).rejects.toThrow("already");
	});
	it("skips sprites whose artwork is missing and reports them", async () => {
		const m = metadata();
		m.assets.chair_64_a_2_0.source = "missing";
		const result = await generateScale32(await bundle(m));
		expect(result.skipped).toBe(1);
		const { json } = parseNitroBundle(result.bundle);
		expect(
			(json.assets as Record<string, unknown>).chair_32_a_0_0,
		).toBeDefined();
		expect(
			(json.assets as Record<string, unknown>).chair_32_a_2_0,
		).toBeUndefined();
	});
});
it("restores trimmed sprite geometry before reducing it", async () => {
	const png = await sharp({
		create: { width: 2, height: 2, channels: 4, background: "#00ff00" },
	})
		.png()
		.toBuffer();
	const source = createNitroBundle(
		{
			name: "trim",
			assets: { trim_64_a_0_0: { x: 4, y: 6 } },
			visualizations: [{ size: 64 }],
			spritesheet: {
				frames: {
					trim_64_a_0_0: {
						frame: { x: 0, y: 0, w: 2, h: 2 },
						trimmed: true,
						sourceSize: { w: 6, h: 8 },
						spriteSourceSize: { x: 2, y: 4, w: 2, h: 2 },
					},
				},
			},
		},
		png,
		"trim",
	);
	const generated = await generateScale32(source);
	const { json } = parseNitroBundle(generated.bundle);
	expect(
		(json.spritesheet as { frames: Record<string, { sourceSize: unknown }> })
			.frames.trim_32_a_0_0.sourceSize,
	).toEqual({ w: 3, h: 4 });
	const pixels = await sharp(
		Buffer.from(generated.after.split(",")[1], "base64"),
	)
		.raw()
		.toBuffer();
	expect([...pixels.subarray((2 * 3 + 1) * 4, (2 * 3 + 1) * 4 + 4)]).toEqual([
		0, 255, 0, 255,
	]);
	expect(pixels[3]).toBe(0);
});
it("unrotates atlas artwork before generating the smaller frame", async () => {
	const source = createNitroBundle(
		{
			name: "rot",
			assets: { rot_64_a_0_0: {} },
			visualizations: [{ size: 64 }],
			spritesheet: {
				frames: {
					rot_64_a_0_0: { frame: { x: 0, y: 0, w: 2, h: 6 }, rotated: true },
				},
			},
		},
		await sharp({
			create: { width: 2, height: 6, channels: 4, background: "#ff0000" },
		})
			.png()
			.toBuffer(),
		"rot",
	);
	const generated = await generateScale32(source);
	const size = await sharp(
		Buffer.from(generated.after.split(",")[1], "base64"),
	).metadata();
	expect([size.width, size.height]).toEqual([3, 1]);
});
it("fills an empty scale declaration and retains namespaced frame naming", async () => {
	const m = metadata();
	const originalFrames = m.spritesheet.frames;
	const source = createNitroBundle(
		{
			...m,
			visualizations: [
				{ size: 32, layerCount: 1, angle: 45, directions: { 0: {}, 2: {} } },
				...m.visualizations,
			],
			spritesheet: {
				...m.spritesheet,
				frames: { chair_chair_64_a_0_0: originalFrames.chair_64_a_0_0 },
			},
		},
		await sharp({
			create: { width: 6, height: 8, channels: 4, background: "#ff0000" },
		})
			.png()
			.toBuffer(),
		"chair",
	);
	const result = parseNitroBundle((await generateScale32(source)).bundle);

	expect(
		(result.json.visualizations as { size: number }[]).filter(
			(v) => v.size === 32,
		),
	).toHaveLength(1);
	expect(
		(result.json.spritesheet as { frames: Record<string, unknown> }).frames
			.chair_chair_32_a_0_0,
	).toBeDefined();
});
it("handles frame keys with a .png suffix and namespaced naming", async () => {
	const m = metadata();
	const frames = m.spritesheet.frames as Record<string, unknown>;
	for (const key of Object.keys(frames) as string[]) {
		frames[`chair_${key}.png`] = frames[key];
		delete frames[key];
	}
	const source = createNitroBundle(
		m,
		await sharp({
			create: { width: 6, height: 8, channels: 4, background: "#ff0000" },
		})
			.png()
			.toBuffer(),
		"chair",
	);
	const result = parseNitroBundle((await generateScale32(source)).bundle);
	expect(
		(result.json.spritesheet as { frames: Record<string, unknown> }).frames[
			"chair_chair_32_a_0_0.png"
		],
	).toBeDefined();
	expect(
		(result.json.assets as Record<string, unknown>).chair_32_a_0_0,
	).toBeDefined();
});
it("rejects bundles that already contain a non-empty scale32 frame", async () => {
	const m = metadata();
	const frames = m.spritesheet.frames as Record<string, unknown>;
	for (const key of Object.keys(frames) as string[]) {
		frames[`chair_${key}.png`] = frames[key];
		delete frames[key];
	}
	(m.assets as Record<string, unknown>).chair_32_a_0_0 = { x: 0, y: 0 };
	frames["chair_chair_32_a_0_0.png"] = {
		frame: { x: 0, y: 0, w: 3, h: 4 },
		rotated: false,
		trimmed: false,
		spriteSourceSize: { x: 0, y: 0, w: 3, h: 4 },
		sourceSize: { w: 3, h: 4 },
	};
	await expect(generateScale32(await bundle(m))).rejects.toThrow("already");
});
