// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	deletes: [] as { table: unknown; where: unknown }[],
	deleteError: null as Error | null,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", async () => {
	const { PERMS } = await import("@/lib/permission-slugs");
	return { PERMS };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {} }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

const mockCatalogFailure = vi.hoisted(() => vi.fn());
vi.mock("@/features/catalog/server/errors", () => ({
	catalogFailure: mockCatalogFailure,
}));

const mockUpdateBcOfferCommand = vi.hoisted(() => vi.fn());
const mockCreateBcOfferCommand = vi.hoisted(() => vi.fn());
vi.mock("@/features/catalog/server/offer-commands", () => ({
	updateBcOfferCommand: mockUpdateBcOfferCommand,
	createBcOfferCommand: mockCreateBcOfferCommand,
}));

const mockUpdatePageCommand = vi.hoisted(() => vi.fn());
const mockCreatePageCommand = vi.hoisted(() => vi.fn());
const mockDeletePageCommand = vi.hoisted(() => vi.fn());
const mockReorderPagesCommand = vi.hoisted(() => vi.fn());
const mockTogglePageCommand = vi.hoisted(() => vi.fn());
vi.mock("@/features/catalog/server/page-commands", () => ({
	updatePageCommand: mockUpdatePageCommand,
	createPageCommand: mockCreatePageCommand,
	deletePageCommand: mockDeletePageCommand,
	reorderPagesCommand: mockReorderPagesCommand,
	togglePageCommand: mockTogglePageCommand,
}));

const mockDeleteCatalogItemsCommand = vi.hoisted(() =>
	vi.fn(async () => ({ deleted: 1, restoreId: 55 })),
);
vi.mock("@/features/catalog/server/item-deletes", () => ({
	deleteCatalogItemsCommand: mockDeleteCatalogItemsCommand,
}));

const mockSendCatalogUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: mockSendCatalogUpdate,
}));

const mockWithCatalogExport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: mockWithCatalogExport,
	catalogExportEnabled: () => true,
}));

const mockLogStaffActivity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			delete: (table: unknown) => ({
				where: (where: unknown) => {
					if (state.deleteError) {
						const e = state.deleteError;
						state.deleteError = null;
						throw e;
					}
					state.deletes.push({ table, where });
					return [{ affectedRows: 1 }];
				},
			}),
		},
	};
});

import {
	createBcItem,
	createBcPage,
	deleteBcItem,
	deleteBcTreePage,
	reorderBcCatalogPages,
	reorderBcTreePage,
	toggleBcPage,
	updateBcItem,
	updateBcPage,
} from "./catalog-bc";

const staff = { id: 3, rank: 6, username: "cat" };

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermission.mockResolvedValue(staff as never);
	state.deletes = [];
	state.deleteError = null;
	mockWithCatalogExport.mockImplementation(
		async (fn: () => unknown) => await fn(),
	);
	mockCatalogFailure.mockReturnValue({
		message: "Catalog op failed",
		status: 400,
	});
	mockCreateBcOfferCommand.mockResolvedValue(501);
	mockCreatePageCommand.mockResolvedValue(201);
	mockSendCatalogUpdate.mockResolvedValue({});
	mockLogStaffActivity.mockResolvedValue(undefined);
	mockUpdateBcOfferCommand.mockResolvedValue({});
	mockUpdatePageCommand.mockResolvedValue({});
	mockDeletePageCommand.mockResolvedValue({});
	mockReorderPagesCommand.mockResolvedValue({});
	mockTogglePageCommand.mockResolvedValue({});
});

describe("updateBcPage", () => {
	it("updates only allowed page fields and logs activity", async () => {
		const result = await updateBcPage({
			id: 1,
			caption: "Renamed",
			pageHeadline: "H",
			foo: "filtered",
			expected: { caption: "Old" },
		});

		expect(result).toEqual({ ok: true });
		expect(mockUpdatePageCommand).toHaveBeenCalledWith(
			"bc",
			1,
			{ caption: "Renamed", pageHeadline: "H" },
			{ caption: "Old" },
			staff.id,
		);
		expect(mockSendCatalogUpdate).toHaveBeenCalled();
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "bc_page_update",
				description: "Updated BC catalog page #1",
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});

	it("rejects when no allowed field is present", async () => {
		const result = await updateBcPage({ id: 1 });
		expect(result).toEqual({
			ok: false,
			error: "No valid fields to update",
		});
		expect(mockUpdatePageCommand).not.toHaveBeenCalled();
	});

	it("maps command failures through catalogFailure", async () => {
		mockUpdatePageCommand.mockRejectedValueOnce(new Error("boom"));
		const result = await updateBcPage({ id: 1, caption: "X" });
		expect(result).toEqual({ ok: false, error: "Catalog op failed" });
		expect(mockCatalogFailure).toHaveBeenCalled();
	});

	it("bubbles up permission errors", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(updateBcPage({ id: 1, caption: "X" })).rejects.toThrow(
			"denied",
		);
	});
});

describe("deleteBcItem", () => {
	it("deletes through the restorable path and logs activity", async () => {
		const result = await deleteBcItem({ id: 7 });
		expect(result).toEqual({
			ok: true,
			data: { deleted: 1, restoreId: 55 },
		});
		// Not a raw DELETE: BC rows are kept so the delete can be undone, the same
		// as the normal catalog.
		expect(mockDeleteCatalogItemsCommand).toHaveBeenCalledWith(
			[7],
			expect.anything(),
			undefined,
			"bc",
		);
		expect(state.deletes).toHaveLength(0);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "bc_item_delete",
				description: "Deleted BC catalog offer #7",
			}),
		);
		expect(mockSendCatalogUpdate).toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});

	it("reports a failed delete instead of pretending it worked", async () => {
		mockDeleteCatalogItemsCommand.mockRejectedValueOnce(Error("db down"));
		mockCatalogFailure.mockReturnValueOnce({ message: "Delete failed" });

		const result = await deleteBcItem({ id: 7 });

		expect(result).toEqual({ ok: false, error: "Delete failed" });
		expect(mockSendCatalogUpdate).not.toHaveBeenCalled();
	});
});

describe("updateBcItem", () => {
	it("updates the offer with only allowed keys", async () => {
		const result = await updateBcItem({
			id: 12,
			catalogName: "New name",
			orderNumber: 4,
			extradata: "ed",
		});
		expect(result).toEqual({ ok: true });
		expect(mockUpdateBcOfferCommand).toHaveBeenCalledWith(12, {
			catalogName: "New name",
			orderNumber: 4,
			extradata: "ed",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});

	it("rejects when no allowed key is present", async () => {
		const result = await updateBcItem({ id: 12 });
		expect(result).toEqual({
			ok: false,
			error: "No valid fields to update",
		});
	});

	it("maps command failures through catalogFailure", async () => {
		mockUpdateBcOfferCommand.mockRejectedValueOnce(new Error("boom"));
		const result = await updateBcItem({ id: 12, catalogName: "X" });
		expect(result).toEqual({ ok: false, error: "Catalog op failed" });
	});
});

describe("createBcItem", () => {
	it("creates the offer and returns its id", async () => {
		const result = await createBcItem({
			pageId: 8,
			itemIds: "1;2",
			catalogName: "Bundle",
			orderNumber: 1,
			extradata: "",
		});
		expect(result).toEqual({ ok: true, data: { id: 501 } });
		expect(mockCreateBcOfferCommand).toHaveBeenCalledWith({
			pageId: 8,
			itemIds: "1;2",
			catalogName: "Bundle",
			orderNumber: 1,
			extradata: "",
		});
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "bc_item_create",
				description: "Created BC catalog item #501",
			}),
		);
	});
});

describe("toggleBcPage", () => {
	it("toggles the requested field", async () => {
		const result = await toggleBcPage({ id: 2, field: "visible" });
		expect(result).toEqual({ ok: true });
		expect(mockTogglePageCommand).toHaveBeenCalledWith(
			"bc",
			2,
			"visible",
			staff.id,
		);
		expect(mockSendCatalogUpdate).toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});
});

describe("createBcPage", () => {
	it("creates a page with default layout fields", async () => {
		const result = await createBcPage({ caption: "Page", parentId: -1 });
		expect(result).toEqual({ ok: true, data: { id: 201 } });
		expect(mockCreatePageCommand).toHaveBeenCalledWith("bc", {
			caption: "Page",
			parentId: -1,
			pageLayout: "default_3x3",
			iconColor: 0,
			iconImage: 0,
			orderNum: 0,
			visible: "1",
			enabled: "1",
			pageHeadline: "",
			pageTeaser: "",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/catalog");
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "bc_page_create",
				description: 'Created BC catalog page "Page"',
			}),
		);
	});

	it("passes explicit values through", async () => {
		await createBcPage({
			caption: "Page",
			parentId: 1,
			pageLayout: "default_3x3",
			iconColor: 3,
			iconImage: 2,
			orderNum: 9,
			enabled: "0",
			visible: "0",
		});
		expect(mockCreatePageCommand).toHaveBeenCalledWith("bc", {
			caption: "Page",
			parentId: 1,
			pageLayout: "default_3x3",
			iconColor: 3,
			iconImage: 2,
			orderNum: 9,
			visible: "0",
			enabled: "0",
			pageHeadline: "",
			pageTeaser: "",
		});
	});
});

describe("reorderBcTreePage", () => {
	it("reparents with new order number", async () => {
		const result = await reorderBcTreePage({
			pageId: 5,
			newParentId: 3,
			newOrderNum: 2,
		});
		expect(result).toEqual({ ok: true, data: {} });
		expect(mockUpdatePageCommand).toHaveBeenCalledWith("bc", 5, {
			parentId: 3,
			orderNum: 2,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/catalog");
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});

	it("allows dropping to the root (undefined parent)", async () => {
		await reorderBcTreePage({ pageId: 5, newOrderNum: 1 });
		expect(mockUpdatePageCommand).toHaveBeenCalledWith("bc", 5, {
			parentId: undefined,
			orderNum: 1,
		});
	});
});

describe("deleteBcTreePage", () => {
	it("deletes with cascade mode", async () => {
		const result = await deleteBcTreePage({ pageId: 4, mode: "cascade" });
		expect(result).toEqual({ ok: true, data: {} });
		expect(mockDeletePageCommand).toHaveBeenCalledWith("bc", 4, "cascade");
		expect(mockSendCatalogUpdate).toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/catalog");
	});

	it("deletes with reparent mode", async () => {
		await deleteBcTreePage({ pageId: 4, mode: "reparent" });
		expect(mockDeletePageCommand).toHaveBeenCalledWith("bc", 4, "reparent");
	});
});

describe("reorderBcCatalogPages", () => {
	it("reorders pages via the command", async () => {
		const input = { parentId: 1, ids: [2, 3], expectedIds: [3, 2] };
		const result = await reorderBcCatalogPages(input);
		expect(result).toEqual({ ok: true, data: {} });
		expect(mockReorderPagesCommand).toHaveBeenCalledWith("bc", input);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/catalog");
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/admin/catalog/builder-club",
		);
	});
});
