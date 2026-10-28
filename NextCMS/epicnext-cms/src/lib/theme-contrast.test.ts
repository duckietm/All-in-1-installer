// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	deriveAdminPalette,
	derivePublicForegrounds,
	ensureReadableThemeColors,
	parseHex,
	readableColor,
	relativeLuminance,
	softLightSurface,
} from "./theme-contrast";

describe("theme-contrast", () => {
	describe("parseHex", () => {
		it("parses 6-digit hex", () => {
			expect(parseHex("#ff0000")).toEqual([255, 0, 0]);
			expect(parseHex("#00ff00")).toEqual([0, 255, 0]);
			expect(parseHex("#0000ff")).toEqual([0, 0, 255]);
			expect(parseHex("#abcdef")).toEqual([171, 205, 239]);
		});
		it("parses 3-digit hex", () => {
			expect(parseHex("#f00")).toEqual([255, 0, 0]);
			expect(parseHex("#0f0")).toEqual([0, 255, 0]);
			expect(parseHex("#00f")).toEqual([0, 0, 255]);
		});
		it("handles case insensitivity", () => {
			expect(parseHex("#FF0000")).toEqual([255, 0, 0]);
			expect(parseHex("#F0F")).toEqual([255, 0, 255]);
		});
		it("returns null for invalid formats", () => {
			expect(parseHex("red")).toBeNull();
			expect(parseHex("#gggggg")).toBeNull();
			expect(parseHex("#12345")).toBeNull();
			expect(parseHex("#1234567")).toBeNull();
			expect(parseHex("")).toBeNull();
		});
	});

	describe("relativeLuminance", () => {
		it("calculates luminance for known colors", () => {
			// White
			expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1.0);
			// Black
			expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0.0);
			// Mid-gray
			expect(relativeLuminance([128, 128, 128])).toBeCloseTo(0.2159, 3);
		});
		it("applies sRGB gamma correction", () => {
			// Value exactly at threshold 0.04045
			const thresholdChannel = Math.round(0.04045 * 255);
			const val = relativeLuminance([
				thresholdChannel,
				thresholdChannel,
				thresholdChannel,
			]);
			expect(val).toBeGreaterThan(0);
		});
	});

	describe("contrastRatio", () => {
		it("returns null for unparseable colors", () => {
			expect(contrastRatio("invalid", "#fff")).toBeNull();
			expect(contrastRatio("#fff", "invalid")).toBeNull();
		});
		it("calculates correct ratios", () => {
			// Black on white = 21:1
			expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
			// White on black = 21:1
			expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
			// Gray on white ~4.5:1
			expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.5, 1);
		});
	});

	describe("readableColor", () => {
		it("returns preferred when ratio is sufficient", () => {
			expect(readableColor("#000000", ["#ffffff"])).toBe("#000000");
			expect(readableColor("#ffffff", ["#000000"])).toBe("#ffffff");
		});
		it("picks best candidate when preferred fails", () => {
			// Gray on light gray fails 4.5:1, should pick black
			expect(readableColor("#999999", ["#cccccc"])).toBe("#000000");
		});
		it("returns preferred when background is unparseable", () => {
			expect(readableColor("#999999", ["invalid"])).toBe("#999999");
		});
	});

	describe("softLightSurface", () => {
		it("returns default for white", () => {
			expect(softLightSurface("#fff", "#eef1f4")).toBe("#eef1f4");
			expect(softLightSurface("#ffffff", "#eef1f4")).toBe("#eef1f4");
			expect(softLightSurface("white", "#eef1f4")).toBe("#eef1f4");
		});
		it("returns default for very light grays", () => {
			expect(softLightSurface("#f8fafc", "#eef1f4")).toBe("#eef1f4");
			expect(softLightSurface("#fafafa", "#eef1f4")).toBe("#eef1f4");
		});
		it("returns original for non-white colors", () => {
			expect(softLightSurface("#1e293b", "#eef1f4")).toBe("#1e293b");
			expect(softLightSurface("#3b82f6", "#eef1f4")).toBe("#3b82f6");
		});
		it("handles undefined/empty", () => {
			expect(softLightSurface(undefined, "#eef1f4")).toBe("#eef1f4");
			expect(softLightSurface("", "#eef1f4")).toBe("#eef1f4");
		});
	});

	describe("deriveAdminPalette", () => {
		const baseColors = {
			color_primary: "#f59e0b",
			color_background: "#0b0f19",
			color_surface: "#151b27",
			color_dropdown: "#1e2635",
			color_text: "#f8fafc",
			color_text_muted: "#94a3b8",
			color_success: "#22c55e",
			color_warning: "#eab308",
			color_error: "#ef4444",
			color_info: "#3b82f6",
			color_navbar: "#080c18",
			color_navbar_text: "#f8fafc",
		};

		it("returns dark defaults when no overrides", () => {
			const p = deriveAdminPalette(baseColors);
			expect(p.canvas).toBe("#0b0f19");
			expect(p.accent).toBe("#f59e0b");
			expect(p.text).toBe("#f8fafc");
		});

		it("applies overrides in dark mode", () => {
			const p = deriveAdminPalette(baseColors, { canvas: "#111111" }, "dark");
			expect(p.canvas).toBe("#111111");
		});

		it("ignores overrides in light mode", () => {
			const p = deriveAdminPalette(baseColors, { canvas: "#111111" }, "light");
			expect(p.canvas).not.toBe("#111111");
			expect(p.canvas).toMatch(/^#[0-9a-f]{6}$/);
		});

		it("uses light defaults when mode=light", () => {
			const lightColors = {
				...baseColors,
				color_background: "#f8fafc",
				color_surface: "#ffffff",
				color_dropdown: "#f1f5f9",
				color_text: "#0f172a",
				color_text_muted: "#64748b",
				color_navbar: "#eef1f4",
				color_navbar_text: "#0f172a",
			};
			const p = deriveAdminPalette(lightColors, {}, "light");
			expect(p.canvas).toBe("#eef1f4"); // softLightSurface kicks in
			expect(p.text).toBe("#0f172a");
		});

		it("handles missing color keys gracefully", () => {
			const p = deriveAdminPalette({ color_primary: "#f00" });
			expect(p.accent).toBe("#f00");
		});
	});

	describe("derivePublicForegrounds", () => {
		const baseColors = {
			color_background: "#f8fafc",
			color_surface: "#ffffff",
			color_dropdown: "#f1f5f9",
			color_navbar: "#f1f5f9",
			color_text: "#0f172a",
			color_text_muted: "#64748b",
			color_navbar_text: "#1e293b",
			color_primary: "#f59e0b",
			color_accent: "#10b981",
			color_success: "#22c55e",
			color_warning: "#eab308",
			color_error: "#ef4444",
			color_info: "#3b82f6",
			link_color: "#f59e0b",
			link_hover_color: "#d97706",
			button_text_color: "#1e293b",
			button_primary_color: "#f59e0b",
			button_secondary_text_color: "#ffffff",
			button_secondary_color: "#22c55e",
			button_danger_text_color: "#ffffff",
			button_danger_color: "#ef4444",
			button_outline_text_color: "#1a1a2e",
		};

		it("returns pairs with readable contrasts", () => {
			const result = derivePublicForegrounds(baseColors);
			expect(result.pairs.length).toBeGreaterThan(0);
			expect(result.byName.body).toBeDefined();
			expect(result.byName.primary).toBeDefined();
			expect(result.byName.accent).toBe("#000000");
		});

		it("handles missing keys with defaults", () => {
			const result = derivePublicForegrounds({});
			expect(result.pairs.length).toBeGreaterThan(0);
		});

		it("generates status pairs", () => {
			const result = derivePublicForegrounds(baseColors);
			expect(result.byName["success-text"]).toBeDefined();
			expect(result.byName["success-solid"]).toBeDefined();
			expect(result.byName["warning-text"]).toBeDefined();
			expect(result.byName["error-solid"]).toBeDefined();
			expect(result.byName["info-solid"]).toBeDefined();
		});
	});

	describe("ensureReadableThemeColors", () => {
		it("fixes low-contrast foregrounds", () => {
			const colors = {
				color_text: "#999999", // too light on white
				color_surface: "#ffffff",
				color_background: "#f8fafc",
				color_navbar_text: "#999999",
				color_navbar: "#ffffff",
				button_text_color: "#999999",
				button_primary_color: "#3b82f6",
				button_secondary_text_color: "#999999",
				button_secondary_color: "#22c55e",
				button_danger_text_color: "#999999",
				button_danger_color: "#ef4444",
				button_outline_text_color: "#999999",
				link_color: "#999999",
				link_hover_color: "#999999",
			};
			const fixed = ensureReadableThemeColors(colors);
			// All should be fixed to black or white
			expect(fixed.color_text).toMatch(/^#(000000|ffffff)$/);
			expect(fixed.color_navbar_text).toMatch(/^#(000000|ffffff)$/);
		});

		it("preserves already-readable colors", () => {
			const colors = {
				color_text: "#0f172a",
				color_surface: "#ffffff",
				color_background: "#f8fafc",
			};
			const fixed = ensureReadableThemeColors(colors);
			expect(fixed.color_text).toBe("#0f172a");
		});

		it("handles missing keys", () => {
			const fixed = ensureReadableThemeColors({});
			expect(fixed).toEqual({});
		});
	});
});
