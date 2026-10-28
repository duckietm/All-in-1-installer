// @ts-nocheck
import { describe, expect, it } from "vitest";
import { activeBanWhere, isBanActive, unixNow } from "./bans";

describe("isBanActive", () => {
	it("treats permanent bans (0) as active", () => {
		expect(isBanActive(0, 12345)).toBe(true);
	});
	it("treats future expiries as active", () => {
		expect(isBanActive(200, 100)).toBe(true);
	});
	it("treats past expiries as inactive", () => {
		expect(isBanActive(100, 200)).toBe(false);
		expect(isBanActive(100, 100)).toBe(false);
	});
});

describe("activeBanWhere", () => {
	it("matches permanent and unexpired bans", () => {
		expect(activeBanWhere(100)).toEqual({
			OR: [{ banExpire: 0 }, { banExpire: { gt: 100 } }],
		});
	});
});

describe("unixNow", () => {
	it("returns seconds since epoch", () => {
		const now = unixNow();
		expect(now).toBeGreaterThan(1_700_000_000);
	});
});
