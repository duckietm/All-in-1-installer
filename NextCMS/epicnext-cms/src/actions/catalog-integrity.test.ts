// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	guard: vi.fn(),
	inspect: vi.fn(),
	preview: vi.fn(),
	apply: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/guard", () => ({
	requirePermissionRateLimited: mocks.guard,
}));
vi.mock("@/lib/permissions", () => import("@/lib/permission-slugs"));
vi.mock("@/lib/safe-action-shared", () => ({
	actionOk: (data: unknown) => ({ ok: true, data }),
	actionError: (error: string) => ({ ok: false, error }),
	handleActionError: () => ({ ok: false, error: "denied" }),
}));
vi.mock("@/lib/services/catalog-audit", () => ({
	inspectLiveCatalogIntegrity: mocks.inspect,
}));
vi.mock("@/lib/services/catalog-repair", () => ({
	previewCatalogParentRepair: mocks.preview,
	applyCatalogParentRepair: mocks.apply,
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: (fn: () => unknown) => fn(),
}));

import { PERMS } from "@/lib/permission-slugs";
import {
	applyCatalogIntegrityRepairAction,
	inspectCatalogIntegrityAction,
	previewCatalogIntegrityRepairAction,
} from "./catalog-integrity";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.guard.mockResolvedValue({ id: 7 });
	mocks.apply.mockResolvedValue({ applied: 1 });
});
describe("integrity action permissions", () => {
	it("allows inspection only after catalog view and preview only after catalog edit", async () => {
		await inspectCatalogIntegrityAction("normal");
		expect(mocks.guard).toHaveBeenLastCalledWith(PERMS.CATALOG_VIEW);
		await previewCatalogIntegrityRepairAction("bc");
		expect(mocks.guard).toHaveBeenLastCalledWith(PERMS.CATALOG_EDIT);
		expect(mocks.preview).toHaveBeenCalledWith("bc");
	});
	it("denies apply before reading or mutating data without edit permission", async () => {
		mocks.guard.mockRejectedValue(new Error("denied"));
		expect(await applyCatalogIntegrityRepairAction("normal", "abc")).toEqual({
			ok: false,
			error: "denied",
		});
		expect(mocks.guard).toHaveBeenCalledWith(PERMS.CATALOG_EDIT);
		expect(mocks.apply).not.toHaveBeenCalled();
	});
	it("forwards actor identity and translates changed state to a recoverable conflict", async () => {
		const error = new Error("changed");
		error.name = "CatalogPreviewConflict";
		mocks.apply.mockRejectedValue(error);
		expect(
			await applyCatalogIntegrityRepairAction("bc", "fingerprint"),
		).toEqual({ ok: false, error: "stalePreview" });
		expect(mocks.apply).toHaveBeenCalledWith("bc", "fingerprint", 7);
	});
	it("rejects unknown catalog names before executing queries", async () => {
		await inspectCatalogIntegrityAction("catalog_pages; DELETE");
		expect(mocks.inspect).not.toHaveBeenCalled();
	});
});
