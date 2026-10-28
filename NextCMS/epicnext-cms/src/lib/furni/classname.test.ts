import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getBaseClassname,
	getBundleFileName,
	getHabboCdnIconUrl,
	getIconFileName,
	getLocalBundleFileNames,
	getLocalIconUrl,
	getNitroFileName,
	getSafeClassnameStem,
	getSwfFileName,
	isValidClassname,
	normalizeClassname,
	resolveLocalBundleExt,
	SOURCE_BUNDLE_EXT,
} from "./classname";

describe("getBaseClassname", () => {
	it("strips the * suffix", () => {
		expect(getBaseClassname("chair_basic*")).toBe("chair_basic");
	});
	it("returns the classname unchanged when no * is present", () => {
		expect(getBaseClassname("chair_basic")).toBe("chair_basic");
	});
});

describe("getSafeClassnameStem", () => {
	it("replaces * with underscore", () => {
		expect(getSafeClassnameStem("wall_plant*")).toBe("wall_plant_");
	});
	it("leaves plain classnames untouched", () => {
		expect(getSafeClassnameStem("lamp_floor")).toBe("lamp_floor");
	});
});

describe("file name helpers", () => {
	it("builds icon file names from the safe stem", () => {
		expect(getIconFileName("sofa_blue*")).toBe("sofa_blue__icon.png");
	});
	it("builds swf file names from the base classname", () => {
		expect(getSwfFileName("sofa_blue*")).toBe("sofa_blue.swf");
	});
	it("builds the primary (`.hab`) bundle name from the base classname", () => {
		expect(getNitroFileName("sofa_blue*")).toBe("sofa_blue.hab");
	});
	it("offers `.hab` first and keeps legacy `.nitro` resolvable", () => {
		expect(getLocalBundleFileNames("sofa_blue*")).toEqual([
			"sofa_blue.hab",
			"sofa_blue.nitro",
		]);
	});
	it("builds a bundle name for an explicit extension", () => {
		expect(getBundleFileName("sofa_blue*", SOURCE_BUNDLE_EXT)).toBe(
			"sofa_blue.nitro",
		);
	});
});

describe("normalizeClassname", () => {
	it("trims and lowercases", () => {
		expect(normalizeClassname("  Chair_Basic ")).toBe("chair_basic");
	});
});

describe("resolveLocalBundleExt", () => {
	it("defaults to .hab", () => {
		expect(resolveLocalBundleExt(undefined)).toBe(".hab");
		expect(resolveLocalBundleExt("")).toBe(".hab");
	});
	it("accepts .nitro and the bare form", () => {
		expect(resolveLocalBundleExt(".nitro")).toBe(".nitro");
		expect(resolveLocalBundleExt("nitro")).toBe(".nitro");
		expect(resolveLocalBundleExt("NITRO")).toBe(".nitro");
	});
	it("accepts .hab and the bare form", () => {
		expect(resolveLocalBundleExt(".hab")).toBe(".hab");
		expect(resolveLocalBundleExt("HAB")).toBe(".hab");
	});
	it("falls back to .hab for unknown values", () => {
		expect(resolveLocalBundleExt("swf")).toBe(".hab");
	});
});

describe("FURNI_BUNDLE_EXT wiring", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("prefers the configured extension and keeps the other as fallback", async () => {
		vi.stubEnv("FURNI_BUNDLE_EXT", ".nitro");
		vi.resetModules();
		const mod = await import("./classname");
		expect(mod.LOCAL_BUNDLE_EXT).toBe(".nitro");
		expect(mod.getNitroFileName("sofa_blue")).toBe("sofa_blue.nitro");
		expect(mod.getLocalBundleFileNames("sofa_blue")).toEqual([
			"sofa_blue.nitro",
			"sofa_blue.hab",
		]);
	});
});

describe("isValidClassname", () => {
	it("accepts lowercase letters, digits and allowed symbols", () => {
		expect(isValidClassname("chair_basic")).toBe(true);
		expect(isValidClassname("sofa*")).toBe(true);
		expect(isValidClassname("wall.part-1")).toBe(true);
	});
	it("rejects uppercase, spaces and invalid characters", () => {
		expect(isValidClassname("Chair")).toBe(false);
		expect(isValidClassname("sofa basic")).toBe(false);
		expect(isValidClassname("sofa/basic")).toBe(false);
		expect(isValidClassname("")).toBe(false);
	});
});

describe("icon URLs", () => {
	it("builds a local icon URL with encoding", () => {
		expect(getLocalIconUrl("sofa_blue")).toBe(
			"/swf/dcr/hof_furni/icons/sofa_blue_icon.png",
		);
		expect(getLocalIconUrl("wall*")).toBe(
			"/swf/dcr/hof_furni/icons/wall__icon.png",
		);
	});
	it("builds a Habbo CDN icon URL with revision and base classname", () => {
		expect(getHabboCdnIconUrl("sofa_blue*", 567)).toBe(
			"https://images.habbo.com/dcr/hof_furni/567/sofa_blue_icon.png",
		);
	});
});
