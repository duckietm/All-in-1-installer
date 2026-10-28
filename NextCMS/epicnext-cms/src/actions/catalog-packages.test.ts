// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	permission: vi.fn(),
	create: vi.fn(),
	save: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
	preview: vi.fn(),
	publish: vi.fn(),
	export: vi.fn(),
	audit: vi.fn(),
	hotel: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_VIEW: "view", CATALOG_EDIT: "edit" },
}));
vi.mock("@/features/catalog/server/packages", () => ({
	createCatalogPackageCommand: mocks.create,
	saveCatalogPackageCommand: mocks.save,
	getCatalogPackageCommand: mocks.get,
	listCatalogPackagesCommand: mocks.list,
	previewCatalogPackageCommand: mocks.preview,
	publishCatalogPackageCommand: mocks.publish,
}));
vi.mock("@/features/catalog/server/package-messages", () => ({
	packageMessage: async (m: string) => m,
}));
vi.mock("@/features/catalog/server/errors", () => ({
	catalogFailure: (e: Error) => ({ message: e.message }),
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: mocks.export,
}));
vi.mock("@/lib/services/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: mocks.hotel,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));

import {
	createCatalogPackage,
	getCatalogPackage,
	listCatalogPackages,
	previewCatalogPackage,
	publishCatalogPackage,
	saveCatalogPackage,
} from "./catalog-packages";

beforeEach(() => {
	vi.resetAllMocks();
	mocks.permission.mockResolvedValue({ id: 7 });
	mocks.export.mockImplementation((fn) => fn());
	mocks.publish.mockResolvedValue({
		pageIds: [4],
		offerCount: 1,
		alreadyPublished: false,
	});
	mocks.hotel.mockResolvedValue({ sent: true });
	mocks.preview.mockResolvedValue({
		version: 1,
		fingerprint: "a".repeat(64),
		changedPages: 1,
		changedOffers: 1,
		conflicts: [],
	});
});
it("keeps draft creation, saving and preview out of live export, audit and hotel updates", async () => {
	await createCatalogPackage({
		name: "Pack",
		pageIds: [1],
		mode: "copy",
		targetParentId: -1,
	});
	await saveCatalogPackage({
		id: "id",
		version: 1,
		name: "Pack",
		draft: { pages: [], offers: [] },
		targetParentId: -1,
	});
	await getCatalogPackage("id");
	await listCatalogPackages();
	await previewCatalogPackage("id");
	expect(mocks.permission.mock.calls.map((c) => c[0])).toEqual([
		"edit",
		"edit",
		"view",
		"view",
		"view",
	]);
	expect(mocks.export).not.toHaveBeenCalled();
	expect(mocks.audit).not.toHaveBeenCalled();
	expect(mocks.hotel).not.toHaveBeenCalled();
});
it("reports committed publication with warnings if audit and hotel updates fail", async () => {
	mocks.audit.mockRejectedValue(Error("audit down"));
	mocks.hotel.mockRejectedValue(Error("hotel down"));
	const result = await publishCatalogPackage({
		id: "id",
		version: 1,
		fingerprint: "a".repeat(64),
	});
	expect(result).toMatchObject({
		ok: true,
		data: { pageIds: [4], warnings: expect.any(Array) },
	});
	if (result.ok) expect(result.data.warnings).toHaveLength(2);
	expect(mocks.permission).toHaveBeenCalledWith("edit");
});
it("does not report a rollback if an export wrapper fails after commit", async () => {
	mocks.export.mockImplementation(async (fn) => {
		await fn();
		throw Error("export failed");
	});
	expect(
		await publishCatalogPackage({
			id: "id",
			version: 1,
			fingerprint: "a".repeat(64),
		}),
	).toMatchObject({
		ok: true,
		data: { warnings: ["Package published, but export scheduling failed."] },
	});
});
it("reports a transaction failure without sending hotel updates or audit", async () => {
	mocks.publish.mockRejectedValue(Error("live conflict"));
	expect(
		await publishCatalogPackage({
			id: "id",
			version: 1,
			fingerprint: "a".repeat(64),
		}),
	).toEqual({ ok: false, error: "live conflict" });
	expect(mocks.audit).not.toHaveBeenCalled();
	expect(mocks.hotel).not.toHaveBeenCalled();
});
it("does not repeat external side effects for an already published package", async () => {
	mocks.publish.mockResolvedValue({
		pageIds: [4],
		offerCount: 1,
		alreadyPublished: true,
	});
	expect(
		await publishCatalogPackage({
			id: "id",
			version: 1,
			fingerprint: "a".repeat(64),
		}),
	).toMatchObject({ ok: true, data: { alreadyPublished: true } });
	expect(mocks.audit).not.toHaveBeenCalled();
	expect(mocks.hotel).not.toHaveBeenCalled();
});
