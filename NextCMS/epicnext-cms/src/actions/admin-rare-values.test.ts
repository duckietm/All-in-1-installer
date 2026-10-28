// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

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

import { WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import {
	createCategory,
	createValue,
	deleteCategory,
	deleteValue,
	updateCategory,
	updateValue,
} from "./admin-rare-values";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	mockRequirePermission.mockResolvedValue({
		id: 10,
		rank: 7,
		username: "admin",
	});
});

describe("createCategory", () => {
	it("creates a category with a floored positive priority", async () => {
		await createCategory(
			form({ name: "  Rares ", badge: " RAR ", priority: "3.9" }),
		);
		expect(mockRequirePermission).toHaveBeenCalledWith("admin.shop.edit");
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteRareValueCategories);
		expect(op.values).toEqual({ name: "Rares", badge: "RAR", priority: 3 });
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("returns early without a name or badge", async () => {
		await createCategory(form({ badge: "X" }));
		await createCategory(form({ name: "Y" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("defaults invalid priorities to 1", async () => {
		await createCategory(form({ name: "A", badge: "B", priority: "-5" }));
		await createCategory(form({ name: "C", badge: "D", priority: "abc" }));
		expect(fakeDbConfig.ops).toHaveLength(2);
		expect(fakeDbConfig.ops[0].values.priority).toBe(1);
		expect(fakeDbConfig.ops[1].values.priority).toBe(1);
	});

	it("swallows insert errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await createCategory(form({ name: "A", badge: "B" }));
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});

describe("deleteCategory", () => {
	it("deletes the category after removing its values", async () => {
		await deleteCategory(form({ id: "7" }));

		expect(fakeDbConfig.ops).toHaveLength(2);
		const [valuesDelete, categoryDelete] = fakeDbConfig.ops;
		expect(valuesDelete.kind).toBe("delete");
		expect(valuesDelete.table).toBe(WebsiteRareValues);
		expect(valuesDelete.where).toBeDefined();
		expect(categoryDelete.kind).toBe("delete");
		expect(categoryDelete.table).toBe(WebsiteRareValueCategories);
		expect(categoryDelete.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("returns early for invalid ids", async () => {
		await deleteCategory(form({ id: "0" }));
		await deleteCategory(form({ id: "abc" }));
		await deleteCategory(new FormData());
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("swallows DB errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteCategory(form({ id: "3" }));
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});

describe("createValue", () => {
	it("creates a value with parsed itemId and wallet fields", async () => {
		await createValue(
			form({
				categoryId: "2",
				name: "Throne",
				furnitureIcon: "throne.png",
				itemId: "101.9",
				creditValue: "500",
				currencyValue: "10",
				currencyType: "diamonds",
			}),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteRareValues);
		expect(op.values).toMatchObject({
			categoryId: 2n,
			name: "Throne",
			furnitureIcon: "throne.png",
			itemId: 101,
			creditValue: "500",
			currencyValue: "10",
			currencyType: "diamonds",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("returns early when categoryId, name or furnitureIcon is missing", async () => {
		await createValue(form({ name: "X", furnitureIcon: "x.png" }));
		await createValue(form({ categoryId: "1", furnitureIcon: "x.png" }));
		await createValue(form({ categoryId: "1", name: "X" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("defaults itemId/values to null and currencyType to diamonds", async () => {
		await createValue(
			form({
				categoryId: "1",
				name: "Empty",
				furnitureIcon: "e.png",
				itemId: "abc",
				currencyType: "  ",
			}),
		);
		expect(fakeDbConfig.ops[0].values).toMatchObject({
			itemId: null,
			creditValue: null,
			currencyValue: null,
			currencyType: "diamonds",
		});
	});

	it("swallows insert errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await createValue(
			form({ categoryId: "1", name: "X", furnitureIcon: "x.png" }),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});

describe("deleteValue", () => {
	it("deletes a value by id", async () => {
		await deleteValue(form({ id: "9" }));
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(WebsiteRareValues);
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("returns early for an invalid id", async () => {
		await deleteValue(form({ id: "-1" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("swallows delete errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteValue(form({ id: "4" }));
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});

describe("updateCategory", () => {
	it("updates an existing category", async () => {
		await updateCategory(
			form({ id: "3", name: "Updated", badge: "B2", priority: "2" }),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(WebsiteRareValueCategories);
		expect(op.set).toEqual({ name: "Updated", badge: "B2", priority: 2 });
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("returns early without an id or without name/badge", async () => {
		await updateCategory(form({ name: "X", badge: "B" }));
		await updateCategory(form({ id: "1", badge: "B" }));
		await updateCategory(form({ id: "1", name: "X" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("swallows update errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await updateCategory(form({ id: "1", name: "X", badge: "B" }));
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});

describe("updateValue", () => {
	it("updates a value including the categoryId when provided", async () => {
		await updateValue(
			form({
				id: "5",
				categoryId: "2",
				name: "Sofa",
				furnitureIcon: "sofa.png",
				itemId: "7",
				creditValue: "1",
				currencyValue: "2",
				currencyType: "points",
			}),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(WebsiteRareValues);
		expect(op.set).toMatchObject({
			name: "Sofa",
			itemId: 7,
			creditValue: "1",
			currencyValue: "2",
			currencyType: "points",
			furnitureIcon: "sofa.png",
			categoryId: 2n,
		});
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});

	it("omits categoryId and nulls invalid fields when they are absent", async () => {
		await updateValue(
			form({ id: "5", name: "Sofa", furnitureIcon: "sofa.png", itemId: "x" }),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.set).not.toHaveProperty("categoryId");
		expect(op.set).toMatchObject({
			name: "Sofa",
			itemId: null,
			creditValue: null,
			currencyValue: null,
			currencyType: "diamonds",
			furnitureIcon: "sofa.png",
		});
	});

	it("returns early without an id or without name/furnitureIcon", async () => {
		await updateValue(form({ name: "X", furnitureIcon: "x.png" }));
		await updateValue(form({ id: "1", furnitureIcon: "x.png" }));
		await updateValue(form({ id: "1", name: "X" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("swallows update errors and still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await updateValue(form({ id: "1", name: "X", furnitureIcon: "x.png" }));
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/rare-values");
	});
});
