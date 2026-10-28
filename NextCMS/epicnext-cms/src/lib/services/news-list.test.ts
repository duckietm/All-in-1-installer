// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/services/news-cache", () => ({
	cacheNews: async () => {
		if (state.fail) throw Error("unavailable");
		return [];
	},
}));
vi.mock("@/lib/db", async () => ({ ...(await import("@/db/schema")), db: {} }));

import { getNewsList } from "./news-list";

beforeEach(() => {
	state.fail = false;
});
it("preserves an empty successful list in strict mode", async () => {
	expect(await getNewsList(4, { throwOnError: true })).toEqual([]);
});
it("lets the homepage distinguish a failed news section", async () => {
	state.fail = true;
	await expect(getNewsList(4, { throwOnError: true })).rejects.toThrow(
		"unavailable",
	);
});
it("preserves the legacy fallback for other callers", async () => {
	state.fail = true;
	expect(await getNewsList(4)).toEqual([]);
});
