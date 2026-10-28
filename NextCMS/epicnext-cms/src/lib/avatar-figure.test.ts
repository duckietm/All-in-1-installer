import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_FIGURE, normalizeAvatarFigure } from "./avatar-figure";

describe("normalizeAvatarFigure", () => {
	it("keeps a figure the imager can draw", () => {
		const figure =
			"hr-11782-40-40.hd-180-7-14.ch-11592-66.lg-10726-79-1408.sh-11764-1408.ha-11958-70-1408.wa-2007-0.0";
		expect(normalizeAvatarFigure(figure)).toBe(figure);
	});

	it("trims surrounding whitespace", () => {
		expect(normalizeAvatarFigure("  hd-180-1  ")).toBe("hd-180-1");
	});

	it("replaces a stored look with an empty colour slot", () => {
		// The legacy register default: `hr-100-` has no colour, so the imager
		// rejects the whole figure with 400 and the avatar renders broken.
		expect(
			normalizeAvatarFigure("hr-100-.hd-180-1.ch-255-66.lg-280-110.sh-305-62"),
		).toBe(DEFAULT_AVATAR_FIGURE);
	});

	it.each([
		"",
		"   ",
		"0",
		"../bad",
		"hd-180-1/../x",
		`hd-180-${"x".repeat(600)}`,
		`hd-180${".a-1".repeat(30)}`,
	])("replaces %j with the default", (value) => {
		expect(normalizeAvatarFigure(value)).toBe(DEFAULT_AVATAR_FIGURE);
	});
});
