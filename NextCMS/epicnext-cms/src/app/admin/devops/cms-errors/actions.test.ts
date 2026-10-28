import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	guard: vi.fn(),
	resolve: vi.fn(),
	assign: vi.fn(),
	audit: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: mocks.guard }));
vi.mock("@/lib/error-monitor", () => ({
	ErrorStore: class {
		resolve = mocks.resolve;
		assign = mocks.assign;
	},
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { DEVOPS_EDIT: "admin.devops.edit" },
}));
vi.mock("@/lib/services/audit", () => ({ logAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignCmsError, resolveCmsError } from "./actions";

it("requires edit permission before resolving or auditing", async () => {
	mocks.guard.mockRejectedValue(new Error("denied"));
	await expect(resolveCmsError(new FormData())).rejects.toThrow("denied");
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(mocks.audit).not.toHaveBeenCalled();
});
it("records who resolved the problem", async () => {
	mocks.guard.mockResolvedValue({ id: 42 });
	mocks.resolve.mockResolvedValue(undefined);
	mocks.audit.mockResolvedValue(undefined);
	const data = new FormData();
	data.set("fingerprint", "aabbccddeeff0011");
	await resolveCmsError(data);
	expect(mocks.guard).toHaveBeenCalledWith("admin.devops.edit");
	expect(mocks.audit).toHaveBeenCalledWith(
		expect.objectContaining({ userId: 42, action: "cms.error.resolve" }),
	);
});

beforeEach(() => vi.clearAllMocks());
it("requires edit permission before assigning", async () => {
	mocks.guard.mockRejectedValue(new Error("denied"));
	await expect(assignCmsError(new FormData())).rejects.toThrow("denied");
	expect(mocks.assign).not.toHaveBeenCalled();
});
it("assigns only the authenticated staff member, ignoring submitted user IDs", async () => {
	mocks.guard.mockResolvedValue({ id: 42 });
	const data = new FormData();
	data.set("fingerprint", "aabbccddeeff0011");
	data.set("assignment", "self");
	data.set("userId", "999");
	await assignCmsError(data);
	expect(mocks.guard).toHaveBeenCalledWith("admin.devops.edit");
	expect(mocks.assign).toHaveBeenCalledWith("aabbccddeeff0011", 42);
	expect(mocks.audit).toHaveBeenCalledWith(
		expect.objectContaining({ userId: 42, action: "cms.error.assign" }),
	);
	data.set("assignment", "clear");
	await assignCmsError(data);
	expect(mocks.assign).toHaveBeenLastCalledWith("aabbccddeeff0011", null);
});
it("rejects unsupported assignment commands", async () => {
	mocks.guard.mockResolvedValue({ id: 42 });
	const data = new FormData();
	data.set("assignment", "other");
	await expect(assignCmsError(data)).rejects.toThrow("Invalid assignment");
	expect(mocks.assign).not.toHaveBeenCalled();
});
