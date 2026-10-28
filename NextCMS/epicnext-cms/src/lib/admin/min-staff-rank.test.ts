// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { siteSettings } from "@/lib/services/site-settings";
import { getMinStaffRank } from "./min-staff-rank";

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn() },
}));

describe("getMinStaffRank", () => {
	it("returns numeric value", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("7");
		expect(await getMinStaffRank()).toBe(7);
	});

	it("uses fallback when setting missing", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("");
		expect(await getMinStaffRank(5)).toBe(5);
	});

	it("floors values", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("7.8");
		expect(await getMinStaffRank()).toBe(7);
	});

	it("rejects zero", async () => {
		vi.mocked(siteSettings.get).mockResolvedValue("0");
		expect(await getMinStaffRank(3)).toBe(3);
	});
});
