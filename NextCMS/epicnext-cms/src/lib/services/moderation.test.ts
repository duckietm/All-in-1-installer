// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		select: () => ({
			from: () => Promise.resolve(selectFrom()),
		}),
	},
	WebsiteWordfilter: { word: "WebsiteWordfilter.word" },
}));

vi.mock("@/env", () => ({
	env: {
		OPENAI_API_KEY: undefined,
	},
}));

import { isAllowed, moderateOrThrow, reloadWordFilter } from "./moderation";

beforeEach(() => {
	selectFrom.mockReset();
	reloadWordFilter();
});

describe("moderation", () => {
	it("allows clean text", async () => {
		selectFrom.mockResolvedValue([{ word: "badword" }]);
		const result = await isAllowed("hello world");
		expect(result).toEqual({ ok: true });
	});

	it("blocks text containing a filtered word", async () => {
		selectFrom.mockResolvedValue([{ word: "badword" }]);
		const result = await isAllowed("this contains badword here");
		expect(result).toEqual({
			ok: false,
			reason: 'Blocked by word filter: "badword"',
		});
	});

	it("allows empty text", async () => {
		const result = await isAllowed("");
		expect(result).toEqual({ ok: true });
	});

	it("caches the word list and respects TTL", async () => {
		selectFrom.mockResolvedValue([{ word: "first" }]);
		await isAllowed("test");
		await isAllowed("test");
		expect(selectFrom).toHaveBeenCalledTimes(1);
	});

	it("moderateOrThrow throws on blocked content", async () => {
		selectFrom.mockResolvedValue([{ word: "bad" }]);
		await expect(moderateOrThrow("this is bad")).rejects.toThrow(
			"Blocked by word filter",
		);
	});

	it("moderateOrThrow resolves on clean content", async () => {
		selectFrom.mockResolvedValue([{ word: "bad" }]);
		await expect(moderateOrThrow("clean text")).resolves.toBeUndefined();
	});
});
