import { describe, expect, it } from "vitest";
import { encodePng } from "@/lib/services/swf/nitro-builder";
import { cropRgba, decodePng } from "./png-decode";

describe("png-decode", () => {
	it("round-trips an RGBA image through encodePng → decodePng", () => {
		const w = 3;
		const h = 2;
		const rgba = Buffer.from([
			// row 0
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
			// row 1
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
		const png = encodePng(w, h, rgba);
		const dec = decodePng(png);
		expect(dec.width).toBe(w);
		expect(dec.height).toBe(h);
		expect(Buffer.compare(dec.rgba, rgba)).toBe(0);
	});

	it("decodes a larger gradient losslessly", () => {
		const w = 16;
		const h = 16;
		const rgba = Buffer.alloc(w * h * 4);
		for (let i = 0; i < w * h; i++) {
			rgba[i * 4] = i % 256;
			rgba[i * 4 + 1] = (i * 3) % 256;
			rgba[i * 4 + 2] = (i * 7) % 256;
			rgba[i * 4 + 3] = 255;
		}
		const dec = decodePng(encodePng(w, h, rgba));
		expect(Buffer.compare(dec.rgba, rgba)).toBe(0);
	});

	it("crops a sub-region", () => {
		// 2x2 sheet, crop the bottom-right 1x1 pixel
		const sheet = Buffer.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
		const cropped = cropRgba(sheet, 2, 1, 1, 1, 1);
		expect([...cropped]).toEqual([4, 4, 4, 4]);
	});

	it("rejects non-PNG input", () => {
		expect(() => decodePng(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
			"not a PNG",
		);
	});
});
