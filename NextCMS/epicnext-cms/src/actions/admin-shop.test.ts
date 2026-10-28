// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	insertResult: [{ insertId: 1 }],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLogStaffActivity = vi.hoisted(() => vi.fn());
const mockLogServerError = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() => vi.fn());

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

vi.mock("next/navigation", () => ({
	redirect: mockRedirect,
}));

vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

vi.mock("@/lib/server-log", () => ({
	logServerError: mockLogServerError,
}));

import { WebsiteShopArticles } from "@/lib/db";
import {
	createShopArticle,
	deleteShopArticle,
	updateShopArticle,
} from "./admin-shop";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	fakeDbConfig.insertResult = [{ insertId: 1 }];
	mockRequirePermission.mockResolvedValue({
		id: 77,
		rank: 7,
		username: "admin",
	});
});

describe("createShopArticle", () => {
	it("creates a package and redirects to the shop", async () => {
		await createShopArticle(
			form({
				name: "Weekend Bundle",
				info: "Stuff",
				icon: "/icons/box.png",
				color: "blue",
				costs: "150.9",
				giveRank: "5",
				credits: "10",
				duckets: "20",
				diamonds: "30",
				badges: "BUNDLE1",
				position: "4",
			}),
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.shop.edit");
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteShopArticles);
		expect(op.values).toMatchObject({
			name: "Weekend Bundle",
			info: "Stuff",
			iconUrl: "/icons/box.png",
			color: "blue",
			costs: 150,
			giveRank: 5,
			credits: 10,
			duckets: 20,
			diamonds: 30,
			badges: "BUNDLE1",
			position: 4,
		});
		expect(op.values.createdAt).toBeInstanceOf(Date);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 77,
			action: "shop_create",
			description: 'Created shop package "Weekend Bundle" (150 costs)',
			targetType: "shop_article",
			targetId: 1,
		});
		expect(mockRedirect).toHaveBeenCalledWith("/admin/shop");
	});

	it("returns early without a name", async () => {
		await createShopArticle(form({ costs: "10" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("defaults missing numeric fields and stores null optionals", async () => {
		await createShopArticle(form({ name: "Basic" }));
		const values = fakeDbConfig.ops[0].values;
		expect(values).toMatchObject({
			info: "",
			iconUrl: "",
			color: "",
			costs: 0,
			giveRank: null,
			credits: null,
			duckets: null,
			diamonds: null,
			badges: null,
			position: 0,
		});
	});

	it("coerces invalid numbers to 0/null", async () => {
		await createShopArticle(
			form({
				name: "Edge",
				costs: "-9",
				giveRank: "abc",
				credits: "-1",
				position: "xyz",
			}),
		);
		const values = fakeDbConfig.ops[0].values;
		expect(values).toMatchObject({
			costs: 0,
			giveRank: null,
			credits: null,
			position: 0,
		});
	});

	it("logs the error and returns without redirecting on insert failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await createShopArticle(form({ name: "Broken" }));
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.shop_create_failed",
			expect.any(Error),
			expect.objectContaining({ staffId: 77, name: "Broken" }),
		);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("rejects when the caller lacks SHOP_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(createShopArticle(form({ name: "X" }))).rejects.toThrow(
			"denied",
		);
	});
});

describe("updateShopArticle", () => {
	it("updates an existing article and redirects", async () => {
		await updateShopArticle(
			form({
				id: "9",
				name: "Renamed",
				info: "New info",
				icon: "/icons/new.png",
				color: "red",
				costs: "50",
				giveRank: "3",
				credits: "5",
				duckets: "",
				diamonds: "",
				badges: "",
				position: "2",
			}),
		);

		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(WebsiteShopArticles);
		expect(op.set).toMatchObject({
			name: "Renamed",
			info: "New info",
			iconUrl: "/icons/new.png",
			color: "red",
			costs: 50,
			giveRank: 3,
			credits: 5,
			duckets: null,
			diamonds: null,
			badges: null,
			position: 2,
		});
		expect(op.set.updatedAt).toBeInstanceOf(Date);
		expect(op.where).toBeDefined();
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "shop_update",
				description: 'Updated shop package #9 ("Renamed")',
				targetId: 9,
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/shop/9");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/shop");
	});

	it("returns early without a valid id", async () => {
		await updateShopArticle(form({ id: "abc", name: "X" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("returns early without a name", async () => {
		await updateShopArticle(form({ id: "1", name: "  " }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("logs the error and returns without rendering guards on failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await updateShopArticle(form({ id: "1", name: "Broken" }));
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.shop_update_failed",
			expect.any(Error),
			expect.objectContaining({ staffId: 77, articleId: "1" }),
		);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).not.toHaveBeenCalled();
	});
});

describe("deleteShopArticle", () => {
	it("deletes an article and redirects", async () => {
		await deleteShopArticle(form({ id: "12" }));
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(WebsiteShopArticles);
		expect(op.where).toBeDefined();
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 77,
			action: "shop_delete",
			description: "Deleted shop package #12",
			targetType: "shop_article",
			targetId: 12,
		});
		expect(mockRedirect).toHaveBeenCalledWith("/admin/shop");
	});

	it("returns early without a valid id", async () => {
		await deleteShopArticle(form({ id: "0" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("logs the error and returns without redirecting on failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteShopArticle(form({ id: "3" }));
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.shop_delete_failed",
			expect.any(Error),
			expect.objectContaining({ staffId: 77, articleId: "3" }),
		);
		expect(mockRedirect).not.toHaveBeenCalled();
	});
});
