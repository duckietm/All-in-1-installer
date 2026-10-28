import { expect, it } from "vitest";
import { inspectNitroScales, resolveNitroFrame } from "./nitro-quality";

const metadata = () => ({
	assets: { chair_64_a_0_0: { x: 2, y: 3 } },
	spritesheet: {
		frames: { chair_64_a_0_0: { frame: { x: 0, y: 0, w: 10, h: 10 } } },
	},
	visualizations: [
		{
			size: 64,
			animations: {
				0: {
					layers: {
						0: { frameSequences: { 0: { frames: { 0: { id: 0 } } } } },
					},
				},
			},
		},
	],
});
it("distinguishes missing 32 from valid authored 64 without generating data", () => {
	const data = metadata(),
		before = JSON.stringify(data),
		report = inspectNitroScales(data, 10, 10);
	expect(report.scales.map((s) => s.state)).toEqual(["missing", "present"]);
	expect(JSON.stringify(data)).toBe(before);
});
it("detects texture bounds and invalid offsets", () => {
	const data = metadata();
	data.assets.chair_64_a_0_0.x = NaN;
	const report = inspectNitroScales(data, 5, 5).scales[1];
	expect(report.issues.map((i) => i.message)).toEqual([
		"Invalid sprite offset",
		"Texture frame is outside the image bounds",
	]);
});
it("resolves referenced sprites and mirrors", () => {
	const data = {
		...metadata(),
		assets: {
			...metadata().assets,
			chair_32_a_0_0: { source: "chair_64_a_0_0", flipH: true },
		},
	};
	expect(resolveNitroFrame(data, "chair_32_a_0_0")).toMatchObject({
		name: "chair_64_a_0_0",
		flipH: true,
	});
});
it("detects cycles instead of hanging", () => {
	expect(() =>
		resolveNitroFrame(
			{ assets: { a: { source: "b" }, b: { source: "a" } } },
			"a",
		),
	).toThrow("Cyclic");
});
it("detects missing animation frames", () => {
	const data = metadata();
	data.visualizations[0].animations[0].layers[0].frameSequences[0].frames[0].id = 9;
	expect(
		inspectNitroScales(data, 10, 10).scales[1].issues[0].message,
	).toContain("frame 9");
});
it("does not invent sprites from visualization metadata alone", () => {
	expect(
		inspectNitroScales({ visualizations: [{ size: 32 }] }, 10, 10).scales[0]
			.state,
	).toBe("issues");
});
it("resolves namespaced atlas frames and mirrored aliases", () => {
	const metadata = {
		name: "chair",
		assets: {
			chair_64_a_0_0: {},
			chair_64_a_2_0: { source: "chair_64_a_0_0", flipH: true },
		},
		spritesheet: {
			frames: { chair_chair_64_a_0_0: { frame: { x: 0, y: 0, w: 4, h: 6 } } },
		},
	};
	expect(resolveNitroFrame(metadata, "chair_64_a_2_0")).toMatchObject({
		name: "chair_chair_64_a_0_0",
		flipH: true,
		frame: { frame: { w: 4, h: 6 } },
	});
});
