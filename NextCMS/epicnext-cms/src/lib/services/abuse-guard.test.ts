// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectFrom = vi.hoisted(() => vi.fn());
const insertValues = vi.hoisted(() => vi.fn());
const getBool = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		select: () => ({
			from: () => Promise.resolve(selectFrom()),
		}),
		insert: () => ({
			values: (data: unknown) => insertValues(data),
		}),
	},
	WebsiteIpBlacklist: { ipAddress: "WebsiteIpBlacklist.ipAddress" },
}));

vi.mock("@/lib/services/alert", () => ({
	ddosDetected: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { getBool, get },
}));

vi.mock("@/env", () => ({ env: {} }));

import { isIpBlacklisted, recordRequest } from "./abuse-guard";

describe("isIpBlacklisted", () => {
	it("returns false for private IPs without DB call", async () => {
		expect(await isIpBlacklisted("127.0.0.1")).toBe(false);
		expect(await isIpBlacklisted("192.168.1.1")).toBe(false);
		expect(await isIpBlacklisted("10.0.0.1")).toBe(false);
		expect(selectFrom).not.toHaveBeenCalled();
	});

	it("loads, caches, and correctly checks multiple IPs", async () => {
		selectFrom.mockResolvedValue([{ ipAddress: "1.2.3.4" }]);

		expect(await isIpBlacklisted("1.2.3.4")).toBe(true);
		expect(await isIpBlacklisted("1.2.3.4")).toBe(true);
		expect(await isIpBlacklisted("5.6.7.8")).toBe(false);
		expect(selectFrom).toHaveBeenCalledTimes(1);

		selectFrom.mockResolvedValue([]);
		expect(await isIpBlacklisted("1.2.3.4")).toBe(true);
	});

	it("handles DB error gracefully (uses stale cache)", async () => {
		selectFrom.mockRejectedValue(new Error("DB error"));
		expect(await isIpBlacklisted("1.2.3.4")).toBe(true);
		expect(await isIpBlacklisted("9.9.9.9")).toBe(false);
	});
});

describe("recordRequest", () => {
	beforeEach(() => {
		getBool.mockReset();
		get.mockReset();
		insertValues.mockReset();
	});

	it("ignores private IPs", async () => {
		await recordRequest("::1");
		expect(getBool).not.toHaveBeenCalled();
	});

	it("respects abuse_guard_enabled setting", async () => {
		getBool.mockResolvedValue(false);
		await recordRequest("1.2.3.4");
		expect(get).not.toHaveBeenCalled();
	});

	it("tracks request counts and blocks exceeding threshold", async () => {
		getBool.mockResolvedValue(true);
		get.mockImplementation(async (_key: string, fallback: string) => {
			if (_key === "abuse_guard_threshold") return "3";
			return fallback;
		});
		insertValues.mockResolvedValue({});

		await recordRequest("1.2.3.4");
		await recordRequest("1.2.3.4");
		expect(insertValues).not.toHaveBeenCalled();

		await recordRequest("1.2.3.4");
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ ipAddress: "1.2.3.4" }),
		);
	});
});
