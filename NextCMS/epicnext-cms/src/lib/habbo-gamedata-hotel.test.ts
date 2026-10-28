// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	habboExternalTextsUrl,
	habboFurnidataUrl,
	habboGamedataHotelShort,
	normalizeHabboGamedataHotel,
} from "./habbo-gamedata-hotel";

describe("habbo-gamedata-hotel", () => {
	it("normalizes known hotels and falls back to it", () => {
		expect(normalizeHabboGamedataHotel("ES")).toBe("es");
		expect(normalizeHabboGamedataHotel("com.br")).toBe("com.br");
		expect(normalizeHabboGamedataHotel("nope")).toBe("it");
		expect(normalizeHabboGamedataHotel(null)).toBe("it");
	});

	it("builds official gamedata URLs", () => {
		expect(habboFurnidataUrl("de")).toBe(
			"https://www.habbo.de/gamedata/furnidata_json/1",
		);
		expect(habboExternalTextsUrl("com.br")).toBe(
			"https://www.habbo.com.br/gamedata/external_flash_texts/1",
		);
	});

	it("formats short hotel labels", () => {
		expect(habboGamedataHotelShort("it")).toBe("IT");
		expect(habboGamedataHotelShort("com.br")).toBe("COM.BR");
	});
});
