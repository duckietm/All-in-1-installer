import { describe, expect, it } from "vitest";
import { themePaletteCss } from "@/lib/theme-css";
import { PRESETS } from "@/lib/theme-presets";

describe("themePaletteCss", () => {
	it("emits separate preset-specific light and dark scopes", () => {
		const ocean = PRESETS.Ocean;
		const css = `${themePaletteCss(":root", ocean.light)}${themePaletteCss("html.dark", ocean.dark)}`;

		expect(css).toContain(":root{");
		expect(css).toContain("html.dark{");
		expect(css).toContain(`--color-primary:${ocean.light.color_primary}`);
		expect(css).toContain(`--color-background:${ocean.light.color_background}`);
		expect(css).toContain(`--color-background:${ocean.dark.color_background}`);
		expect(ocean.dark.color_primary).toBe(ocean.light.color_primary);
		for (const variable of [
			"--color-text-subtle-readable",
			"--color-text-disabled-readable",
			"--admin-sidebar-text-readable",
			"--color-success-text-readable",
			"--color-success-foreground-readable",
			"--color-warning-text-readable",
			"--color-error-text-readable",
			"--color-info-text-readable",
			"--admin-canvas",
			"--admin-surface",
			"--admin-surface-elevated",
			"--admin-text",
			"--admin-text-muted",
			"--admin-border",
			"--admin-accent",
			"--admin-accent-foreground",
			"--admin-overlay",
			"--admin-focus-ring",
			"--admin-success",
			"--admin-warning",
			"--admin-error",
			"--admin-info",
			"--admin-success-subtle",
			"--admin-warning-subtle",
			"--admin-error-border",
			"--admin-info-foreground",
		])
			expect(css).toContain(variable);
	});
});
