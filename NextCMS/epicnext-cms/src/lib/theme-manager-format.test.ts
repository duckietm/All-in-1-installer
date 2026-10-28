// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	normalizeImportedTheme,
	serializeThemeExport,
	swatchColors,
	THEME_ALLOWED_SETTING_KEYS,
	THEME_IMPORT_FORMAT,
} from "@/lib/theme-manager-format";

describe("theme import/export format", () => {
	it("serialises a theme in the native atom-theme-v1 format", () => {
		const json = serializeThemeExport("Summer Gold", {
			color_primary: "#f59e0b",
		});
		const parsed = JSON.parse(json) as Record<string, unknown>;
		expect(parsed.format).toBe(THEME_IMPORT_FORMAT);
		expect(parsed.name).toBe("Summer Gold");
		expect(parsed.settings).toEqual({ color_primary: "#f59e0b" });
	});

	it("normalises the native export shape", () => {
		const result = normalizeImportedTheme(
			{
				format: THEME_IMPORT_FORMAT,
				name: "Pink",
				settings: {
					color_primary: "#e11d48",
					color_primary_dark: "#fb7185",
					custom_css: "body{}",
					unknown_key: "ignored",
					background_image: "/cms_api/media/bg.png",
					bad_color: "url(javascript:alert(1))",
				},
			},
			"Fallback",
		);
		expect(result).toEqual({
			name: "Pink",
			settings: {
				color_primary: "#e11d48",
				color_primary_dark: "#fb7185",
				custom_css: "body{}",
				background_image: "/cms_api/media/bg.png",
			},
		});
	});

	it("normalises the /cms_api/themes/export palette shape", () => {
		const result = normalizeImportedTheme({
			palette: {
				light: { color_primary: "#f59e0b", color_text: "#0f172a" },
				dark: { color_primary: "#fbbf24", color_text: "#f8fafc" },
			},
			cssVariables: {},
			scopes: [],
			meta: { format: THEME_IMPORT_FORMAT },
		});
		expect(result?.settings).toEqual({
			color_primary: "#f59e0b",
			color_primary_dark: "#fbbf24",
			color_text: "#0f172a",
			color_text_dark: "#f8fafc",
		});
	});

	it("rejects non-printable and oversized values", () => {
		const result = normalizeImportedTheme({
			format: THEME_IMPORT_FORMAT,
			settings: {
				color_primary: "#fff\nbackground:red",
				custom_css: "x".repeat(20001),
			},
		});
		expect(result?.settings).toEqual({});
	});

	it("rejects unrecognised payloads", () => {
		expect(normalizeImportedTheme(null)).toBeNull();
		expect(normalizeImportedTheme("nope")).toBeNull();
		expect(normalizeImportedTheme({})).toBeNull();
		expect(normalizeImportedTheme({ format: "other" })).toBeNull();
	});

	it("restricts imported settings to the known theme keys", () => {
		expect(THEME_ALLOWED_SETTING_KEYS.has("color_primary")).toBe(true);
		expect(THEME_ALLOWED_SETTING_KEYS.has("background_image")).toBe(true);
		expect(THEME_ALLOWED_SETTING_KEYS.has("custom_themes")).toBe(false);
		expect(THEME_ALLOWED_SETTING_KEYS.has("link_color")).toBe(true);
	});

	it("builds swatch colours from a saved snapshot", () => {
		expect(
			swatchColors({ color_primary: "#f59e0b", color_accent: "#10b981" }),
		).toEqual(["#f59e0b", "#10b981", "#64748b", "#64748b"]);
	});
});
