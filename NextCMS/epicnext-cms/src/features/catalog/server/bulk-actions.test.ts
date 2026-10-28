import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	permission: vi.fn(),
	preview: vi.fn(),
	destinations: vi.fn(),
	apply: vi.fn(),
	undo: vi.fn(),
	export: vi.fn(),
	send: vi.fn(),
	audit: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: state.permission }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_VIEW: "view", CATALOG_EDIT: "edit" },
}));
vi.mock("@/features/catalog/server/bulk-offers", () => ({
	previewBulkOffersCommand: state.preview,
	listBulkOfferDestinationsCommand: state.destinations,
	applyBulkOffersCommand: state.apply,
	undoBulkOffersCommand: state.undo,
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: state.export,
}));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: state.send,
}));
vi.mock("@/lib/services/audit", () => ({ logAudit: state.audit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: state.refresh }));

import {
	applyBulkOffers,
	getBulkOfferDestinations,
	previewBulkOffers,
	undoBulkOffers,
} from "@/actions/catalog-bulk";

const input = { ids: [1], changes: { pageId: 2 } };
beforeEach(() => {
	vi.clearAllMocks();
	state.permission.mockResolvedValue({ id: 1 });
	state.export.mockImplementation((fn) => fn());
	state.apply.mockResolvedValue({ changedCount: 1 });
	state.preview.mockResolvedValue({ fingerprint: "x" });
	state.audit.mockResolvedValue(undefined);
});
it("gates read preview without scheduling any mutation", async () => {
	await previewBulkOffers(input);
	expect(state.permission).toHaveBeenCalledWith("view");
	expect(state.export).not.toHaveBeenCalled();
	expect(state.apply).not.toHaveBeenCalled();
});
it("gates edits before database and sends one update after commit", async () => {
	expect((await applyBulkOffers(input, "x")).ok).toBe(true);
	expect(state.permission).toHaveBeenCalledWith("edit");
	expect(state.export).toHaveBeenCalledTimes(1);
	expect(state.send).not.toHaveBeenCalled();
	expect(state.refresh).toHaveBeenCalled();
});
it("stops denied permission before export or data access", async () => {
	state.permission.mockRejectedValueOnce(Error("Denied"));
	await expect(applyBulkOffers(input, "x")).rejects.toThrow("Denied");
	expect(state.export).not.toHaveBeenCalled();
});
it("does not notify hotel when a transaction fails", async () => {
	state.apply.mockRejectedValueOnce(Error("failed"));
	expect((await applyBulkOffers(input, "x")).ok).toBe(false);
	expect(state.send).not.toHaveBeenCalled();
	expect(state.audit).not.toHaveBeenCalled();
});
it("does not report a committed edit as failed on audit failure", async () => {
	state.audit.mockRejectedValueOnce(Error("log failed"));
	expect((await applyBulkOffers(input, "x")).ok).toBe(true);
	expect(state.send).not.toHaveBeenCalled();
});

it("loads destination choices with view permission only", async () => {
	state.destinations.mockResolvedValueOnce({
		pages: [{ id: 9, caption: "Target" }],
	});
	expect(await getBulkOfferDestinations()).toEqual({
		ok: true,
		data: { pages: [{ id: 9, caption: "Target" }] },
	});
	expect(state.permission).toHaveBeenCalledWith("view");
	expect(state.export).not.toHaveBeenCalled();
});

it("undo enforces edit access and exports only successful restores", async () => {
	state.undo.mockResolvedValueOnce({ changedCount: 2 });
	expect((await undoBulkOffers([10, 11])).ok).toBe(true);
	expect(state.permission).toHaveBeenCalledWith("edit");
	expect(state.undo).toHaveBeenCalledWith([10, 11], 1, undefined);
	expect(state.export).toHaveBeenCalledTimes(1);
	expect(state.send).not.toHaveBeenCalled();
});
it("undo denial stops before export and a conflict does not notify", async () => {
	state.permission.mockRejectedValueOnce(Error("Denied"));
	await expect(undoBulkOffers([10])).rejects.toThrow("Denied");
	expect(state.export).not.toHaveBeenCalled();
	state.undo.mockRejectedValueOnce(Error("conflict"));
	expect((await undoBulkOffers([10])).ok).toBe(false);
	expect(state.send).not.toHaveBeenCalled();
});

it("passes a stable operation key and does not synchronously notify after commit", async () => {
	const key = "123e4567-e89b-42d3-a456-426614174000";
	expect((await applyBulkOffers(input, "x", key)).ok).toBe(true);
	expect(state.apply).toHaveBeenCalledWith(input, "x", 1, key, "normal");
	expect(state.send).not.toHaveBeenCalled();
});
