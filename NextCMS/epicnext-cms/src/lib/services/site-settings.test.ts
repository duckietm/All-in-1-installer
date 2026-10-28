// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectFrom, redisMock } = vi.hoisted(() => ({
	selectFrom: vi.fn(),
	redisMock: {
		get: vi.fn(),
		setex: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("@/lib/db", () => ({
	db: {
		select: () => ({
			from: () => Promise.resolve(selectFrom()),
		}),
		insert: () => ({
			values: () => ({
				onDuplicateKeyUpdate: () => Promise.resolve(),
			}),
		}),
	},
	WebsiteSetting: { key: "WebsiteSetting.key", value: "WebsiteSetting.value" },
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { siteSettings } from "./site-settings";

beforeEach(async () => {
	selectFrom.mockReset();
	redisMock.get.mockReset();
	redisMock.setex.mockReset();
	redisMock.del.mockReset();
	redisMock.get.mockResolvedValue(null);
	redisMock.setex.mockResolvedValue(undefined);
	redisMock.del.mockResolvedValue(undefined);
	await siteSettings.reload();
});

describe("siteSettings", () => {
	it("returns a value by key", async () => {
		selectFrom.mockResolvedValue([{ key: "hotel_name", value: "AtomHotel" }]);
		expect(await siteSettings.get("hotel_name")).toBe("AtomHotel");
	});

	it("returns the fallback when key is missing", async () => {
		selectFrom.mockResolvedValue([]);
		expect(await siteSettings.get("missing", "fallback")).toBe("fallback");
		expect(await siteSettings.get("missing")).toBeNull();
	});

	it("coerces '1'/'0' string booleans", async () => {
		selectFrom.mockResolvedValue([
			{ key: "maintenance_enabled", value: "1" },
			{ key: "radio_enabled", value: "0" },
		]);
		expect(await siteSettings.getBool("maintenance_enabled")).toBe(true);
		expect(await siteSettings.getBool("radio_enabled")).toBe(false);
		expect(await siteSettings.getBool("missing", true)).toBe(true);
	});

	it("fetches once and caches until reload", async () => {
		selectFrom.mockResolvedValue([{ key: "hotel_name", value: "AtomHotel" }]);
		await siteSettings.get("hotel_name");
		await siteSettings.getBool("hotel_name");
		expect(selectFrom).toHaveBeenCalledTimes(1);
		await siteSettings.reload();
		await siteSettings.get("hotel_name");
		expect(selectFrom).toHaveBeenCalledTimes(2);
	});

	it("re-reads the database on a Redis miss instead of serving stale cache", async () => {
		vi.useFakeTimers();
		try {
			selectFrom.mockResolvedValue([{ key: "hotel_name", value: "First" }]);
			expect(await siteSettings.get("hotel_name")).toBe("First");

			selectFrom.mockResolvedValue([{ key: "hotel_name", value: "Second" }]);
			vi.setSystemTime(Date.now() + 2 * 60_000); // expire the in-memory cache
			expect(await siteSettings.get("hotel_name")).toBe("Second");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not promote defaults to Redis when the database fails", async () => {
		selectFrom.mockRejectedValue(new Error("db down"));
		expect(await siteSettings.get("hotel_name", "fallback")).toBe("fallback");
		expect(redisMock.setex).not.toHaveBeenCalled();
	});

	it("recovers from a transient database failure on the next load", async () => {
		selectFrom.mockRejectedValueOnce(new Error("db down"));
		expect(await siteSettings.get("hotel_name", "fallback")).toBe("fallback");

		selectFrom.mockResolvedValueOnce([{ key: "hotel_name", value: "Live" }]);
		expect(await siteSettings.get("hotel_name")).toBe("Live");
		expect(redisMock.setex).toHaveBeenCalledTimes(1);
	});
});
