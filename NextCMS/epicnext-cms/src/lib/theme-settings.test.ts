// @ts-nocheck
import { describe, expect, it } from "vitest";
import { PRESETS, THEME_COLOR_KEYS } from "@/lib/theme-presets";
import { presetSettings, settingKey } from "@/lib/theme-settings";

describe("theme settings mapping", () => {
	it("keeps legacy light keys and suffixes dark keys", () => {
		expect(settingKey("color_primary", "light")).toBe("color_primary");
		expect(settingKey("color_primary", "dark")).toBe("color_primary_dark");
	});

	it("serializes every preset key for both modes without duplicates", () => {
		const settings = presetSettings(PRESETS.Ocean);
		const keys = settings.map(([key]) => key);

		expect(settings).toHaveLength(THEME_COLOR_KEYS.length * 2);
		expect(new Set(keys).size).toBe(keys.length);
		for (const key of THEME_COLOR_KEYS) {
			expect(keys).toContain(key);
			expect(keys).toContain(`${key}_dark`);
		}
	});
});
