// @ts-nocheck

import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { logger } from "@/lib/logger";
import { ActionError } from "@/lib/safe-action-shared";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { fakeForm } from "@/test/fake-form";
import { createAd, deleteAd } from "./admin-ads";

const { insertValues, deleteWhere } = vi.hoisted(() => {
	const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
	const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	return { insertValues, deleteWhere };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { PAGES_EDIT: "pages.edit" } }));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
			})),
		})),
		delete: vi.fn(() => ({ where: deleteWhere })),
	},
	WebsiteAds: { id: "id" },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/safe-action", () => ({
	adminAction: vi.fn((_o: unknown, f: (...args: unknown[]) => unknown) => f),
}));
vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: class extends Error {},
	actionOk: vi.fn(() => "ok"),
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("createAd", () => {
	it("creates ad and redirects", async () => {
		await createAd(
			fakeForm({ image: "https://example.com/ad.png" }) as FormData,
		);
		expect(insertValues).toHaveBeenCalled();
		expect(logStaffActivity).toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/admin/ads");
	});

	it("returns early when image empty", async () => {
		await createAd(fakeForm({ image: "" }) as FormData);
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("logs error on db failure", async () => {
		insertValues.mockRejectedValue(new Error("db"));
		await createAd(fakeForm({ image: "x" }) as FormData);
		expect(logger.error).toHaveBeenCalled();
	});
});

describe("deleteAd", () => {
	it("deletes ad and returns ok", async () => {
		const h = deleteAd as unknown as (ctx: {
			data: { id: bigint };
			session: { user: { id: string } };
		}) => Promise<string>;
		expect(
			await h({ data: { id: BigInt(99) }, session: { user: { id: "1" } } }),
		).toBe("ok");
	});

	it("throws ActionError when not found", async () => {
		deleteWhere.mockResolvedValue([{ affectedRows: 0 }]);
		const h = deleteAd as unknown as (ctx: {
			data: { id: bigint };
			session: { user: { id: string } };
		}) => Promise<string>;
		await expect(
			h({ data: { id: BigInt(999) }, session: { user: { id: "1" } } }),
		).rejects.toThrow(ActionError);
	});
});
