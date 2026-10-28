// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: true,
	query: vi.fn(async () => [{ id: 2, classname: "sofa", name: "Sofa" }]),
}));
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: vi.fn(async () => {
		if (!state.allowed) throw new Error("forbidden");
	}),
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_VIEW: "catalog.view" },
}));
vi.mock("@/lib/db", () => ({
	ItemsBase: { id: "id", itemName: "itemName", publicName: "publicName" },
	db: { select: () => ({ from: () => ({ where: state.query }) }) },
}));

import { requirePermission } from "@/lib/admin/guard";
import { getCatalogPreviewAssets } from "./catalog-preview-assets";

describe("preview asset authorization and bounds", () => {
	beforeEach(() => {
		state.allowed = true;
		state.query.mockClear();
	});
	it("checks catalog viewing permission before querying", async () => {
		state.allowed = false;
		await expect(getCatalogPreviewAssets([2])).rejects.toThrow("forbidden");
		expect(requirePermission).toHaveBeenCalledWith("catalog.view");
		expect(state.query).not.toHaveBeenCalled();
	});
	it("rejects oversized and invalid requests without querying", async () => {
		expect((await getCatalogPreviewAssets(Array(201).fill(2))).ok).toBe(false);
		expect((await getCatalogPreviewAssets([NaN, -2])).ok).toBe(false);
		expect(state.query).not.toHaveBeenCalled();
	});
	it("returns only database-backed classname and display name", async () => {
		expect(await getCatalogPreviewAssets([2, 2])).toEqual({
			ok: true,
			assets: [{ id: 2, classname: "sofa", name: "Sofa" }],
		});
		expect(state.query).toHaveBeenCalledOnce();
	});
});
