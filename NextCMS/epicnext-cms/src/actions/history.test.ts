// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	guard: vi.fn(),
	apply: vi.fn(),
	snapshot: vi.fn(),
	entry: {
		kind: "prices",
		targetId: 1,
		before: { costCredits: 1 },
		after: { costCredits: 2 },
	},
}));
vi.mock("@/lib/db", () => ({
	db: {
		transaction: async (callback: (tx: object) => unknown) => callback({}),
	},
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: state.guard }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { LOGS_VIEW: "logs", CATALOG_EDIT: "catalog", NEWS_EDIT: "news" },
}));
vi.mock("@/features/history/server", () => ({
	readHistory: async () => state.entry,
	historySnapshot: state.snapshot,
	applyHistory: state.apply,
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: async (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/services/news-cache", () => ({ invalidateNewsCache: vi.fn() }));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { previewHistoryRestore, restoreHistory } from "./history";

beforeEach(() => {
	vi.clearAllMocks();
	state.guard.mockResolvedValue({ id: 7 });
	state.snapshot.mockResolvedValue(state.entry.after);
	state.apply.mockResolvedValue(undefined);
	state.entry.kind = "prices";
});
it("requires logs access and catalog edit on preview and restore", async () => {
	await previewHistoryRestore(1);
	await restoreHistory(1);
	expect(state.guard.mock.calls.map((call) => call[0])).toEqual([
		"logs",
		"catalog",
		"logs",
		"catalog",
	]);
});
it("requires news edit for news history", async () => {
	state.entry.kind = "news";
	await restoreHistory(1);
	expect(state.guard).toHaveBeenCalledWith("news");
});
it("rejects forbidden restore before any mutation", async () => {
	state.guard.mockRejectedValue(Error("Forbidden"));
	await expect(restoreHistory(1)).rejects.toThrow("Forbidden");
	expect(state.apply).not.toHaveBeenCalled();
});
it("returns conflict when current data changed after preview", async () => {
	await previewHistoryRestore(1);
	state.apply.mockRejectedValue(Error("conflict"));
	await expect(restoreHistory(1)).resolves.toEqual({
		ok: false,
		code: "conflict",
	});
});
