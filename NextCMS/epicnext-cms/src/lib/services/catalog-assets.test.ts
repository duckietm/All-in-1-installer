// @ts-nocheck
import { describe, expect, it } from "vitest";
import { catalogueAssetDirectories } from "@/lib/services/catalog-assets";
import { getRuntimePath } from "@/lib/utils/runtime-path";

describe("catalogue asset directories", () => {
	it("prefers the configured Gamedata catalogue and retains the bundled fallback", () => {
		const cwd = getRuntimePath("test", "cms");
		const gamedataRoot = getRuntimePath("test", "Gamedata");

		expect(catalogueAssetDirectories(gamedataRoot, cwd)).toEqual([
			getRuntimePath(gamedataRoot, "c_images", "catalogue"),
			getRuntimePath(cwd, "public", "swf", "c_images", "catalogue"),
		]);
	});

	it("uses only the bundled catalogue when no Gamedata root is configured", () => {
		const cwd = getRuntimePath("test", "cms");

		expect(catalogueAssetDirectories("", cwd)).toEqual([
			getRuntimePath(cwd, "public", "swf", "c_images", "catalogue"),
		]);
	});
});
