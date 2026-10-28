// @ts-nocheck
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
	db: {},
	CatalogPages: {},
	ItemsBase: {},
}));

vi.mock("@/lib/services/furni-data", () => ({
	appendFurniEntry: vi.fn(),
	buildFurniEntry: vi.fn(),
	removeFurniEntry: vi.fn(),
	findFurniDataIdConflict: vi.fn(),
}));

vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	lookupOfficialHabboFurni: vi.fn(),
}));

vi.mock("@/lib/services/import/core/download", () => ({
	downloadFile: vi.fn(),
	validatePngBytes: vi.fn(),
	validateSwfBytes: vi.fn(),
}));

vi.mock("@/lib/services/swf-to-nitro", () => {
	const convertSwfToNitro = vi.fn();
	const extractIconFromSwf = vi.fn();
	return {
		convertSwfToNitro,
		extractIconFromSwf,
		convertSwfToNitroAsync: vi.fn(async (buffer: Buffer, classname: string) =>
			convertSwfToNitro(buffer, classname),
		),
		extractIconFromSwfAsync: vi.fn(async (buffer: Buffer, classname: string) =>
			extractIconFromSwf(buffer, classname),
		),
	};
});

import {
	autoPriceFurni,
	buildItemsBaseEnrichmentUpdate,
	classifyFurni,
	resetCatalogPageCache,
} from "./furni-import";

describe("buildItemsBaseEnrichmentUpdate", () => {
	it("only updates columns present in the live Arcturus items_base schema", () => {
		const update = buildItemsBaseEnrichmentUpdate({
			id: 123,
			dims: { x: 2, y: 3, z: 1.5 },
			cansiton: true,
			canlayon: false,
			canstandon: true,
			allowStack: "1",
			interactionType: "default",
		});

		const serialized = JSON.stringify(update);
		expect(serialized).not.toContain("specialtype");
		expect(serialized).toContain("UPDATE items_base");
		expect(serialized).toContain("123");
		expect(serialized).toContain("1.5");
		expect(serialized).toContain("default");
	});
});

describe("classifyFurni", () => {
	it("classifies credits by classname prefix", () => {
		expect(classifyFurni("CF_750_credits", "s")).toBe("credits");
		expect(classifyFurni("exe_50", "s")).toBe("credits");
	});

	it("classifies wired by classname prefix", () => {
		expect(classifyFurni("wf_act_1", "s")).toBe("wired");
	});

	it("classifies wall items by type", () => {
		expect(classifyFurni("wallposter", "i")).toBe("walls");
	});

	it("falls back to 'other' for unknown classnames", () => {
		expect(classifyFurni("custom_item", "s")).toBe("other");
	});
});

describe("autoPriceFurni", () => {
	it("extracts credit value from CF_ prefix", () => {
		const price = autoPriceFurni("CF_750_credits");
		expect(price.credits).toBe(750);
	});

	it("prices rares at 25 credits", () => {
		const price = autoPriceFurni("rare_habbo_max");
		expect(price.credits).toBe(25);
	});

	it("prices default items at 3 credits", () => {
		const price = autoPriceFurni("random_furni");
		expect(price.credits).toBe(3);
	});
});

describe("resetCatalogPageCache", () => {
	it("is a callable function that does not throw", () => {
		expect(() => resetCatalogPageCache()).not.toThrow();
	});
});
