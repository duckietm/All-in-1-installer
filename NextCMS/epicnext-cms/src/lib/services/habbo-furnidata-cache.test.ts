// @ts-nocheck
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHabboGamedataHotelMock } = vi.hoisted(() => ({
	getHabboGamedataHotelMock: vi.fn(),
}));

vi.mock("@/lib/services/habbo-gamedata-hotel", () => ({
	getHabboGamedataHotel: getHabboGamedataHotelMock,
}));

vi.mock("@/lib/logger", () => ({
	logger: { warn: vi.fn(), debug: vi.fn() },
}));

import * as cacheModule from "./habbo-furnidata-cache";

function fixture(classname: string, name: string) {
	return {
		roomitemtypes: {
			furnitype: [
				{
					id: 1,
					classname,
					name,
					description: "",
					revision: 100,
				},
			],
		},
		wallitemtypes: { furnitype: [] },
	};
}

describe("official Habbo furnidata cache", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		const cacheApi = cacheModule as unknown as {
			clearOfficialHabboFurnidataCache?: () => void;
			clearHabboItCache?: () => void;
		};
		(
			cacheApi.clearOfficialHabboFurnidataCache ?? cacheApi.clearHabboItCache
		)?.();
	});

	it("exports a generic API and isolates cached data by configured hotel", async () => {
		const generic = cacheModule as unknown as {
			getOfficialHabboFurnidata?: () => Promise<Map<string, { name: string }>>;
		};
		expect(generic.getOfficialHabboFurnidata).toBeTypeOf("function");
		if (!generic.getOfficialHabboFurnidata) return;

		getHabboGamedataHotelMock
			.mockResolvedValueOnce("it")
			.mockResolvedValueOnce("nl");
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(fixture("italian_chair", "Sedia"))),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify(fixture("dutch_chair", "Stoel"))),
			);
		vi.stubGlobal("fetch", fetchMock);

		const italian = await generic.getOfficialHabboFurnidata();
		const dutch = await generic.getOfficialHabboFurnidata();

		expect(italian.get("italian_chair")?.name).toBe("Sedia");
		expect(dutch.get("dutch_chair")?.name).toBe("Stoel");
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://www.habbo.nl/gamedata/furnidata_json/1",
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: expect.stringContaining("application/json"),
				}),
			}),
		);
	});
});
