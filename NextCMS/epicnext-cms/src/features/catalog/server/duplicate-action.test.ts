import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	failAudit: false,
	permission: vi.fn(),
	export: vi.fn(async (fn: () => unknown) => fn()),
	sync: vi.fn(async () => ({ sent: true })),
	audit: vi.fn(async () => {
		if (state.failAudit) throw Error("Audit unavailable");
	}),
	command: vi.fn(async () => ({ id: 44, pages: 2, offers: 3 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: async (permission: string) => {
		state.permission(permission);
		return { id: 7 };
	},
}));
vi.mock("@/features/catalog/server/duplicate-commands", () => ({
	duplicateCategoryCommand: state.command,
	previewDuplicateCommand: vi.fn(async () => ({ pages: 2 })),
	duplicateDestinationsCommand: vi.fn(async () => []),
}));
vi.mock("@/features/catalog/server/sync-status", () => ({
	sendCatalogUpdate: state.sync,
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: state.export,
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: state.audit,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import {
	applyCatalogDuplicate,
	previewCatalogDuplicate,
} from "@/actions/catalog-duplicate";
import { PERMS } from "@/lib/permissions";

const input = {
	kind: "normal" as const,
	sourceId: 1,
	parentId: -1,
	name: "Copy",
	fingerprint: "a".repeat(64),
	pages: 2,
	offers: 3,
	destination: "Root",
};
beforeEach(() => {
	vi.clearAllMocks();
	state.failAudit = false;
});
it("requires view for preview and edit for duplication, exports and syncs once", async () => {
	await previewCatalogDuplicate(input);
	expect(state.permission).toHaveBeenLastCalledWith(PERMS.CATALOG_VIEW);
	expect(state.export).not.toHaveBeenCalled();
	const result = await applyCatalogDuplicate(input);
	expect(result.ok).toBe(true);
	expect(state.permission).toHaveBeenLastCalledWith(PERMS.CATALOG_EDIT);
	expect(state.command).toHaveBeenCalledOnce();
	expect(state.export).toHaveBeenCalledOnce();
	expect(state.sync).toHaveBeenCalledOnce();
	expect(state.audit).toHaveBeenCalledOnce();
});
it("preserves successful result after commit when audit logging fails", async () => {
	state.failAudit = true;
	await expect(applyCatalogDuplicate(input)).resolves.toMatchObject({
		ok: true,
		data: { id: 44 },
	});
	expect(state.command).toHaveBeenCalledOnce();
});
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_EDIT: "catalog.edit", CATALOG_VIEW: "catalog.view" },
}));
