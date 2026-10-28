// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	staff: { id: 11, rank: 7, username: "staff" },
	requirePermissionRateLimited: vi.fn(),
	listingRows: [] as unknown[],
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	logStaffActivity: vi.fn(async () => undefined),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermissionRateLimited: mocks.requirePermissionRateLimited,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { SHOP_EDIT: "admin.shop.edit" },
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mocks.logStaffActivity,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => mocks.listingRows);
	return {
		...schema,
		db: {
			...fake,
			update: vi.fn(() => ({ set: mocks.updateSet })),
		},
	};
});

import { PERMS } from "@/lib/permissions";
import { cancelMarketplaceListing } from "./admin-marketplace";

function form(id: string) {
	const f = new FormData();
	f.set("id", id);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermissionRateLimited.mockResolvedValue(mocks.staff);
	mocks.listingRows = [];
	mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
	mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("cancelMarketplaceListing", () => {
	it("cancels an active listing, logs activity and revalidates", async () => {
		mocks.listingRows = [
			{ id: 5, state: 1, userId: 3, itemId: 100, price: 250 },
		];

		await cancelMarketplaceListing(form("5"));

		expect(mocks.requirePermissionRateLimited).toHaveBeenCalledWith(
			PERMS.SHOP_EDIT,
		);
		expect(mocks.updateSet).toHaveBeenCalledWith({ state: 0 });
		expect(mocks.logStaffActivity).toHaveBeenCalledWith({
			staffId: 11,
			action: "marketplace_cancel",
			description:
				"Cancelled marketplace listing #5 (item 100, user 3, price 250)",
			targetType: "marketplace",
			targetId: 5,
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/marketplace");
	});

	it("returns early for a non-positive id", async () => {
		await cancelMarketplaceListing(form("0"));

		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.logStaffActivity).not.toHaveBeenCalled();
	});

	it("does nothing when the listing does not exist", async () => {
		mocks.listingRows = [];

		await cancelMarketplaceListing(form("8"));

		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("does nothing when the listing is not active", async () => {
		mocks.listingRows = [{ id: 9, state: 0, userId: 1, itemId: 2, price: 3 }];

		await cancelMarketplaceListing(form("9"));

		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermissionRateLimited.mockRejectedValueOnce(
			new Error("redirect:/admin"),
		);

		await expect(cancelMarketplaceListing(form("1"))).rejects.toThrow(
			"redirect:/admin",
		);
		expect(mocks.updateSet).not.toHaveBeenCalled();
	});
});
