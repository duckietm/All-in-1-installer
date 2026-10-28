// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn() },
}));

vi.mock("@/lib/services/import/core/gordon", () => ({
	resolveGordonBuildUrl: vi.fn(),
}));

import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";
import {
	__clearEffectSourceCache,
	listOfficialEffects,
	resolveEffectSwfUrl,
} from "./effect-source";

const EFFECTMAP_XML = `<?xml version="1.0"?>
<effectmap>
  <effect id="1" lib="fx_1" />
  <effect id="2" lib="fx_2" type="seat" revision="3" />
  <effect id="bad" />
</effectmap>`;

describe("listOfficialEffects", () => {
	beforeEach(() => {
		__clearEffectSourceCache();
		fetchMock.mockReset();
	});

	it("parses the effectmap XML into entries", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => EFFECTMAP_XML,
		});
		const list = await listOfficialEffects();
		expect(list).toHaveLength(2);
		expect(list[0]).toEqual({ id: "1", lib: "fx_1", type: "fx", revision: 0 });
		expect(list[1]).toEqual({
			id: "2",
			lib: "fx_2",
			type: "seat",
			revision: 3,
		});
	});

	it("caches results across calls", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => EFFECTMAP_XML,
		});
		await listOfficialEffects();
		await listOfficialEffects();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns cached list when fetch fails", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			text: async () => EFFECTMAP_XML,
		});
		await listOfficialEffects();
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: async () => "",
		});
		const list = await listOfficialEffects();
		expect(list).toHaveLength(2);
	});

	it("returns empty array on first fetch failure", async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "",
		});
		await expect(listOfficialEffects()).resolves.toEqual([]);
	});
});

describe("resolveEffectSwfUrl", () => {
	beforeEach(() => {
		vi.mocked(siteSettings.get).mockReset();
		vi.mocked(resolveGordonBuildUrl).mockReset();
	});

	it("uses override when set", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue(
			"https://cdn.example.com/effects/",
		);
		await expect(resolveEffectSwfUrl("fx_1")).resolves.toBe(
			"https://cdn.example.com/effects/fx_1.swf",
		);
	});

	it("falls back to gordon build URL", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("");
		vi.mocked(resolveGordonBuildUrl).mockResolvedValue(
			"https://www.habbo.com/gordon/",
		);
		await expect(resolveEffectSwfUrl("fx_1")).resolves.toBe(
			"https://www.habbo.com/gordon/fx_1.swf",
		);
	});
});
