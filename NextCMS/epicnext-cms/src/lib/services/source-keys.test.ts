// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn() },
}));

vi.mock("@/lib/services/import/core/gordon", () => ({
	resolveGordonBuildUrl: vi.fn(),
}));

import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";
import { resolveFigureSwfUrl } from "./figure-source";
import { CANONICAL_PETS, resolvePetSwfUrl } from "./pet-source";

describe("resolveFigureSwfUrl", () => {
	beforeEach(() => {
		vi.mocked(siteSettings.get).mockReset();
		vi.mocked(resolveGordonBuildUrl).mockReset();
	});

	it("uses override when set, trimming trailing slashes", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue(
			"https://cdn.example.com/swf/",
		);
		await expect(resolveFigureSwfUrl("h_std_15")).resolves.toBe(
			"https://cdn.example.com/swf/h_std_15.swf",
		);
	});

	it("falls back to gordon build URL when no override", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("");
		vi.mocked(resolveGordonBuildUrl).mockResolvedValue(
			"https://www.habbo.com/gordon/",
		);
		await expect(resolveFigureSwfUrl("h_std_15")).resolves.toBe(
			"https://www.habbo.com/gordon/h_std_15.swf",
		);
	});
});

describe("resolvePetSwfUrl", () => {
	beforeEach(() => {
		vi.mocked(siteSettings.get).mockReset();
		vi.mocked(resolveGordonBuildUrl).mockReset();
	});

	it("uses override when set", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue(
			"https://cdn.example.com/pets",
		);
		await expect(resolvePetSwfUrl("dog")).resolves.toBe(
			"https://cdn.example.com/pets/dog.swf",
		);
	});

	it("falls back to gordon build URL", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue(null);
		vi.mocked(resolveGordonBuildUrl).mockResolvedValue(
			"https://www.habbo.com/gordon/",
		);
		await expect(resolvePetSwfUrl("cat")).resolves.toBe(
			"https://www.habbo.com/gordon/cat.swf",
		);
	});
});

describe("CANONICAL_PETS", () => {
	it("includes the classic pet set", () => {
		expect(CANONICAL_PETS).toContain("dog");
		expect(CANONICAL_PETS).toContain("cat");
		expect(CANONICAL_PETS).toContain("horse");
		expect(CANONICAL_PETS).toContain("monsterplant");
		expect(CANONICAL_PETS).toContain("bunnyeaster");
	});
	it("has no duplicates", () => {
		expect(new Set(CANONICAL_PETS).size).toBe(CANONICAL_PETS.length);
	});
});
