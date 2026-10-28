// @ts-nocheck
import { describe, expect, it } from "vitest";
import { catalogueAssetUrl, catalogueIconUrl } from "@/lib/catalog-assets";

describe("catalogue asset URLs", () => {
	it("uses the production gamedata mount for category icons", () => {
		expect(catalogueIconUrl(7)).toBe("/gamedata/c_images/catalogue/icon_7.png");
	});

	// A few catalogue icons exist only as `.gif`, so the picker retries with it.
	it("can build the `.gif` variant of a category icon", () => {
		expect(catalogueIconUrl(1542, "gif")).toBe(
			"/gamedata/c_images/catalogue/icon_1542.gif",
		);
	});

	it("encodes catalogue image names and supports both image formats", () => {
		expect(catalogueAssetUrl("front page", "png")).toBe(
			"/gamedata/c_images/catalogue/front%20page.png",
		);
		expect(catalogueAssetUrl("front page", "gif")).toBe(
			"/gamedata/c_images/catalogue/front%20page.gif",
		);
	});
});
