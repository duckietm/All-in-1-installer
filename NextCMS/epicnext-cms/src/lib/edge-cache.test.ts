import { beforeEach, describe, expect, it, vi } from "vitest";

const purgeCacheByTags = vi.fn();
const cloudflareEnabled = vi.fn();

vi.mock("@/lib/cloudflare-api", () => ({
	purgeCacheByTags: (...args: unknown[]) => purgeCacheByTags(...args),
	cloudflareEnabled: (...args: unknown[]) => cloudflareEnabled(...args),
}));

import {
	EDGE_CACHE_TAGS,
	purgeEdgeCache,
	resetEdgeCacheCoalescing,
} from "@/lib/edge-cache";

describe("purgeEdgeCache", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		resetEdgeCacheCoalescing();
	});

	it("is a no-op when Cloudflare is not configured", async () => {
		cloudflareEnabled.mockReturnValue(false);
		await purgeEdgeCache(["cms-public"], "test");
		expect(purgeCacheByTags).not.toHaveBeenCalled();
	});

	it("purges the requested tags when enabled", async () => {
		cloudflareEnabled.mockReturnValue(true);
		await purgeEdgeCache([EDGE_CACHE_TAGS.public], "shop edited");
		expect(purgeCacheByTags).toHaveBeenCalledExactlyOnceWith(["cms-public"]);
	});

	it("coalesces repeated purges of the same tag within 30s", async () => {
		cloudflareEnabled.mockReturnValue(true);
		await purgeEdgeCache(["cms-public"], "first");
		await purgeEdgeCache(["cms-public"], "second");
		expect(purgeCacheByTags).toHaveBeenCalledTimes(1);
		expect(purgeCacheByTags).toHaveBeenCalledWith(["cms-public"]);
	});

	it("purges again after the coalescing window has passed", async () => {
		cloudflareEnabled.mockReturnValue(true);
		await purgeEdgeCache(["cms-gamedata"], "first");
		await purgeEdgeCache(["cms-gamedata"], "second");
		expect(purgeCacheByTags).toHaveBeenCalledTimes(1);
		resetEdgeCacheCoalescing();
		await purgeEdgeCache(["cms-gamedata"], "third");
		expect(purgeCacheByTags).toHaveBeenCalledTimes(2);
	});

	it("never throws on an upstream failure", async () => {
		cloudflareEnabled.mockReturnValue(true);
		purgeCacheByTags.mockRejectedValue(new Error("boom"));
		await expect(
			purgeEdgeCache(["cms-public"], "fails"),
		).resolves.toBeUndefined();
	});
});
