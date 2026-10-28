import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	reorder: vi.fn(),
	send: vi.fn(),
	permission: vi.fn(),
}));
vi.mock("@/features/catalog/server/page-commands", () => ({
	reorderPagesCommand: state.reorder,
}));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: state.send,
}));
vi.mock("@/features/catalog/server/errors", () => ({
	catalogFailure: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: state.permission }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_EDIT: "catalog.edit" },
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: async (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { reorderCatalogPages } from "@/actions/catalog";

beforeEach(() => {
	vi.clearAllMocks();
	state.reorder.mockResolvedValue(undefined);
	state.permission.mockResolvedValue({ id: 1 });
});
it("requests only one hotel update after a complete sibling reorder", async () => {
	const input = { parentId: 1, ids: [3, 2], expectedIds: [2, 3] };
	await reorderCatalogPages(input);
	expect(state.reorder).toHaveBeenCalledWith("normal", input);
	expect(state.send).toHaveBeenCalledOnce();
	expect(state.permission).toHaveBeenCalledWith("catalog.edit");
});
it("does not request a hotel update for a rejected reorder", async () => {
	state.reorder.mockRejectedValueOnce(Error("conflict"));
	await expect(
		reorderCatalogPages({ parentId: 1, ids: [3, 2], expectedIds: [2, 3] }),
	).rejects.toThrow();
	expect(state.send).not.toHaveBeenCalled();
});
