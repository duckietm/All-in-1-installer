import { describe, expect, it } from "vitest";
import { isAnimatedPng } from "./imager-png";

function png(chunks: Array<{ type: string; data?: number[] }>): Uint8Array {
	const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (const chunk of chunks) {
		const data = chunk.data ?? [];
		const len = data.length;
		bytes.push(
			(len >>> 24) & 0xff,
			(len >>> 16) & 0xff,
			(len >>> 8) & 0xff,
			len & 0xff,
			...chunk.type.split("").map((c) => c.charCodeAt(0)),
			...data,
			0,
			0,
			0,
			0,
		);
	}
	return new Uint8Array(bytes);
}

describe("isAnimatedPng", () => {
	it("returns false for non-PNG input", () => {
		expect(isAnimatedPng(new Uint8Array([1, 2, 3]))).toBe(false);
		expect(isAnimatedPng(new Uint8Array())).toBe(false);
	});

	it("returns false for a plain PNG", () => {
		const plain = png([{ type: "IHDR" }, { type: "IDAT" }, { type: "IEND" }]);
		expect(isAnimatedPng(plain)).toBe(false);
	});

	it("returns true when an acTL chunk precedes IDAT", () => {
		const anim = png([
			{ type: "IHDR" },
			{ type: "acTL", data: [0, 16, 0, 0] },
			{ type: "IDAT" },
			{ type: "IEND" },
		]);
		expect(isAnimatedPng(anim)).toBe(true);
	});

	it("ignores an acTL chunk that appears after IDAT", () => {
		const late = png([
			{ type: "IHDR" },
			{ type: "IDAT" },
			{ type: "acTL", data: [0, 16, 0, 0] },
		]);
		expect(isAnimatedPng(late)).toBe(false);
	});

	it("does not loop forever on a corrupt chunk length", () => {
		const corrupt = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff, 0xff, 0xff,
			0x49, 0x48, 0x44, 0x52,
		]);
		expect(isAnimatedPng(corrupt)).toBe(false);
	});
});
