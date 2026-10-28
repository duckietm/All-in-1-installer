// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as hotelHelpers from "@/lib/habbo-gamedata-hotel";

describe("furni import source metadata", () => {
	it("describes the configured hotel without changing the global asset CDN", () => {
		const helpers = hotelHelpers as unknown as {
			buildFurniImportSource?: (hotel: string) => {
				hotel: string;
				label: string;
				host: string;
				furnidataUrl: string;
				assetCdnHost: string;
			};
			officialHabboEnrichmentWarning?: (hotel: string, name: string) => string;
		};

		expect(helpers.buildFurniImportSource).toBeTypeOf("function");
		expect(helpers.officialHabboEnrichmentWarning).toBeTypeOf("function");
		if (
			!helpers.buildFurniImportSource ||
			!helpers.officialHabboEnrichmentWarning
		) {
			return;
		}

		expect(helpers.buildFurniImportSource("nl")).toEqual({
			hotel: "nl",
			label: "Netherlands (habbo.nl)",
			host: "habbo.nl",
			furnidataUrl: "https://www.habbo.nl/gamedata/furnidata_json/1",
			assetCdnHost: "images.habbo.com",
		});
		expect(helpers.officialHabboEnrichmentWarning("nl", "Stoel")).toBe(
			'Enriched from habbo.nl: "Stoel"',
		);
	});
});
