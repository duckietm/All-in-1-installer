// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	permission: vi.fn(),
	retry: vi.fn(),
	audit: vi.fn(),
	refresh: vi.fn(),
	error: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));
vi.mock("@/lib/services/audit", () => ({ logAudit: mocks.audit }));
vi.mock("./server", () => ({ retryEffect: mocks.retry }));

import { retryDelivery } from "./retry-action";

const id = "840f4023-04cd-4d7b-92c5-047aa620029c";
beforeEach(() => {
	vi.resetAllMocks();
	mocks.permission.mockResolvedValue({ id: 7 });
	mocks.retry.mockResolvedValue(undefined);
	mocks.audit.mockResolvedValue(undefined);
});
it("rejects unauthorized access before touching the delivery", async () => {
	mocks.permission.mockRejectedValue(new Error("Forbidden"));
	await expect(retryDelivery(id)).rejects.toThrow("Forbidden");
	expect(mocks.retry).not.toHaveBeenCalled();
	expect(mocks.audit).not.toHaveBeenCalled();
});
it("reports a rejected retry without recording a successful action", async () => {
	mocks.retry.mockRejectedValue(new Error("Database unavailable"));
	expect(await retryDelivery(id)).toMatchObject({ ok: false });
	expect(mocks.audit).not.toHaveBeenCalled();
	expect(mocks.refresh).not.toHaveBeenCalled();
});
it("records the delivery UUID as audit metadata", async () => {
	expect(await retryDelivery(id)).toMatchObject({ ok: true });
	expect(mocks.audit).toHaveBeenCalledWith(
		expect.objectContaining({ userId: 7, after: { deliveryId: id } }),
	);
});
it("does not report a committed retry as failed when audit and refresh fail", async () => {
	mocks.audit.mockRejectedValue(new Error("Audit unavailable"));
	mocks.refresh.mockImplementation(() => {
		throw new Error("Refresh unavailable");
	});
	expect(await retryDelivery(id)).toMatchObject({ ok: true });
	expect(mocks.retry).toHaveBeenCalledTimes(1);
	expect(mocks.error).toHaveBeenCalled();
});
