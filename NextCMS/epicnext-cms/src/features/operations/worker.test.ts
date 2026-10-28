// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	claim: vi.fn(),
	complete: vi.fn(),
	fail: vi.fn(),
	news: vi.fn(),
	catalog: vi.fn(),
	exportEnabled: vi.fn(),
	request: vi.fn(),
	error: vi.fn(),
}));
vi.mock("./server", () => ({
	effectRepository: {
		claim: mocks.claim,
		complete: mocks.complete,
		fail: mocks.fail,
	},
}));
vi.mock("@/lib/services/news-cache", () => ({
	refreshNewsCacheForDelivery: mocks.news,
}));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: mocks.catalog,
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	catalogExportEnabled: mocks.exportEnabled,
	catalogExportQueue: () => ({ request: mocks.request }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));

import { drainOperationEffects } from "./worker";

const effect = {
	id: "one",
	token: "lease",
	attempts: 1,
	topic: "news.refresh",
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.claim.mockResolvedValueOnce(effect).mockResolvedValue(null);
	mocks.news.mockResolvedValue(undefined);
});
it("invalidates the shared news cache before acknowledging delivery", async () => {
	await drainOperationEffects();
	expect(mocks.news).toHaveBeenCalledTimes(1);
	expect(mocks.complete).toHaveBeenCalledWith(effect);
	expect(mocks.fail).not.toHaveBeenCalled();
});
it("keeps a failed news invalidation retryable", async () => {
	const error = new Error("Redis unavailable");
	mocks.news.mockRejectedValue(error);
	await drainOperationEffects();
	expect(mocks.fail).toHaveBeenCalledWith(effect, error);
	expect(mocks.complete).not.toHaveBeenCalled();
});
