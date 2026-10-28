// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ finish: vi.fn(), log: vi.fn() }));
vi.mock("./catalog-git-config", () => ({
	readManagedCatalogConfig: () => ({ enabled: true }),
	catalogStateRoot: () => "unused",
}));
vi.mock("./catalog-git-core", () => ({
	CatalogExportQueue: class {
		async begin() {
			return state.finish;
		}
	},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: state.log } }));

import { isCatalogMutation, withCatalogExport } from "./catalog-git-queue";

beforeEach(() => {
	vi.clearAllMocks();
	state.finish.mockRejectedValue(Error("disk full"));
});
it("does not turn a committed create into a failed action when queue completion fails", async () => {
	expect(await withCatalogExport(async () => ({ ok: true, id: 42 }))).toEqual({
		ok: true,
		id: 42,
	});
	expect(state.log).toHaveBeenCalled();
});
it("preserves the original mutation error if cleanup also fails", async () => {
	await expect(
		withCatalogExport(async () => {
			throw Error("database conflict");
		}),
	).rejects.toThrow("database conflict");
});

it("keeps hotel retries independent from Git export scheduling", () => {
	expect(isCatalogMutation("POST", "/cms_api/admin/catalog/status")).toBe(false);
	expect(isCatalogMutation("POST", "/cms_api/admin/catalog/status/")).toBe(false);
	expect(isCatalogMutation("PATCH", "/cms_api/admin/catalog/tree")).toBe(true);
	expect(isCatalogMutation("POST", "/cms_api/admin/import/furni")).toBe(true);
});
