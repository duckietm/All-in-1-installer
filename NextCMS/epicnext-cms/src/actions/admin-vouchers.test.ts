// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	insertResult: [{ insertId: 1 }],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLogServerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeActionDb } = await import("@/test/fake-db-actions");
	return { ...schema, db: createFakeActionDb(fakeDbConfig) };
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { SHOP_EDIT: "admin.shop.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("@/lib/server-log", () => ({
	logServerError: mockLogServerError,
}));

vi.mock("@/lib/safe-action-shared", () => ({
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
	actionError: (message: string) => ({ ok: false, error: message }),
}));

import { WebsiteShopVouchers } from "@/lib/db";
import { createVoucher, deleteVoucher, updateVoucher } from "./admin-vouchers";

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	fakeDbConfig.insertResult = [{ insertId: 1 }];
	mockRequirePermission.mockResolvedValue({
		id: 8,
		rank: 7,
		username: "admin",
	});
});

describe("createVoucher", () => {
	it("creates a voucher with parsed amount/uses/expiry", async () => {
		const result = await createVoucher({
			code: "  SUMMER  ",
			amount: 99.7,
			maxUses: 5.9,
			expiresAt: "2026-01-01T00:00:00.000Z",
		});

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.shop.edit");
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteShopVouchers);
		expect(op.values).toMatchObject({
			code: "SUMMER",
			amount: 99,
			maxUses: 5,
			useCount: 0,
		});
		expect(op.values.expiresAt).toBeInstanceOf(Date);
		expect(op.values.createdAt).toBeInstanceOf(Date);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/vouchers");
		expect(result).toEqual({ ok: true, data: { id: "1" } });
	});

	it("defaults maxUses to 1 and expiry to null", async () => {
		await createVoucher({ code: "BASIC", amount: 10, maxUses: 0 });
		const op = fakeDbConfig.ops[0];
		expect(op.values.maxUses).toBe(1);
		expect(op.values.expiresAt).toBeNull();
	});

	it("treats an unparseable expiry as null", async () => {
		await createVoucher({
			code: "BAD_DATE",
			amount: 10,
			maxUses: -3,
			expiresAt: "not-a-date",
		});
		const op = fakeDbConfig.ops[0];
		expect(op.values.maxUses).toBe(1);
		expect(op.values.expiresAt).toBeNull();
	});

	it("rejects a blank code or non-positive amount", async () => {
		const blank = await createVoucher({ code: "   ", amount: 10, maxUses: 1 });
		expect(blank).toEqual({
			ok: false,
			error: "Code and a positive amount are required",
		});
		const zero = await createVoucher({ code: "X", amount: 0, maxUses: 1 });
		expect(zero.ok).toBe(false);
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("rejects when the caller lacks SHOP_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(
			createVoucher({ code: "X", amount: 1, maxUses: 1 }),
		).rejects.toThrow("denied");
	});

	it("returns an error when the insert fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		const result = await createVoucher({ code: "X", amount: 1, maxUses: 1 });
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.voucher_create_failed",
			expect.any(Error),
		);
		expect(result).toEqual({
			ok: false,
			error: "Could not create voucher (code may already exist)",
		});
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});

describe("deleteVoucher", () => {
	it("deletes a voucher by id", async () => {
		const result = await deleteVoucher({ id: "5" });
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(WebsiteShopVouchers);
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/vouchers");
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("rejects invalid ids", async () => {
		for (const id of ["", "0", "-1", "abc"]) {
			const result = await deleteVoucher({ id });
			expect(result).toEqual({ ok: false, error: "Missing voucher id" });
		}
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns an error when the delete fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		const result = await deleteVoucher({ id: "5" });
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.voucher_delete_failed",
			expect.any(Error),
			{ voucherId: "5" },
		);
		expect(result).toEqual({ ok: false, error: "Could not delete voucher" });
	});
});

describe("updateVoucher", () => {
	it("updates a voucher", async () => {
		const result = await updateVoucher({
			id: "9",
			code: "UPDATED",
			amount: 12.8,
			maxUses: 2.4,
			expiresAt: "2026-06-01T00:00:00.000Z",
		});

		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(WebsiteShopVouchers);
		expect(op.set).toMatchObject({
			code: "UPDATED",
			amount: 12,
			maxUses: 2,
		});
		expect(op.set.expiresAt).toBeInstanceOf(Date);
		expect(op.set.updatedAt).toBeInstanceOf(Date);
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/vouchers");
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("defaults maxUses/expiry when invalid", async () => {
		await updateVoucher({
			id: "9",
			code: "X",
			amount: 1,
			maxUses: Number.NaN,
			expiresAt: "garbage",
		});
		const op = fakeDbConfig.ops[0];
		expect(op.set.maxUses).toBe(1);
		expect(op.set.expiresAt).toBeNull();
	});

	it("rejects an invalid id", async () => {
		const result = await updateVoucher({
			id: "0",
			code: "X",
			amount: 1,
			maxUses: 1,
		});
		expect(result).toEqual({ ok: false, error: "Missing voucher id" });
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("rejects a blank code or non-positive amount", async () => {
		const blank = await updateVoucher({
			id: "1",
			code: "",
			amount: 1,
			maxUses: 1,
		});
		expect(blank.ok).toBe(false);
		const zero = await updateVoucher({
			id: "1",
			code: "X",
			amount: -4,
			maxUses: 1,
		});
		expect(zero.ok).toBe(false);
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns an error when the update fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		const result = await updateVoucher({
			id: "9",
			code: "X",
			amount: 1,
			maxUses: 1,
		});
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.voucher_update_failed",
			expect.any(Error),
			{ voucherId: "9" },
		);
		expect(result).toEqual({
			ok: false,
			error: "Could not update voucher (code may already exist)",
		});
	});
});
