// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
	updatePageCommand: vi.fn(),
	deletePageCommand: vi.fn(),
}));
vi.mock("@/features/catalog/server/page-commands", () => commands);
const insertValues = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());
const updateSetData = vi.hoisted(() => vi.fn());
const updateWhere = vi.hoisted(() => vi.fn());
const deleteWhere = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		insert: () => ({ values: insertValues }),
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => Promise.resolve(selectLimit()),
				}),
				orderBy: () => ({
					where: () => ({
						limit: () => Promise.resolve(selectLimit()),
					}),
				}),
			}),
		}),
		update: () => ({
			set: (data: Record<string, unknown>) => {
				updateSetData(data);
				return {
					where: () => updateWhere(data),
				};
			},
		}),
		delete: () => ({
			where: () => Promise.resolve(deleteWhere()),
		}),
		execute: executeMock,
	},
	CatalogPages: { id: "CatalogPages.id", parentId: "CatalogPages.parentId" },
}));

vi.mock("@/env", () => ({ env: {} }));

import type { TreeNode } from "@/types/catalog";
import {
	buildNestedTree,
	createPage,
	deletePage,
	getAncestors,
	movePage,
	toInt,
} from "./catalog-tree";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("toInt", () => {
	it("converts valid numbers", () => {
		expect(toInt(42)).toBe(42);
		expect(toInt("42")).toBe(42);
	});

	it("uses fallback for invalid", () => {
		expect(toInt("abc", -1)).toBe(-1);
		expect(toInt(NaN, 0)).toBe(0);
	});

	it("defaults fallback to 0", () => {
		expect(toInt("abc")).toBe(0);
	});
});

describe("buildNestedTree", () => {
	const flat: TreeNode[] = [
		{
			id: 1,
			caption: "Root",
			parentId: -1,
			depth: 0,
			orderNum: 1,
			enabled: "1",
			visible: "1",
			iconImage: 0,
			iconColor: 0,
			pageLayout: "default_3x3",
			childCount: 2,
			itemCount: 0,
		},
		{
			id: 2,
			caption: "Child",
			parentId: 1,
			depth: 1,
			orderNum: 1,
			enabled: "1",
			visible: "1",
			iconImage: 0,
			iconColor: 0,
			pageLayout: "default_3x3",
			childCount: 1,
			itemCount: 5,
		},
		{
			id: 3,
			caption: "Grandchild",
			parentId: 2,
			depth: 2,
			orderNum: 1,
			enabled: "1",
			visible: "1",
			iconImage: 0,
			iconColor: 0,
			pageLayout: "default_3x3",
			childCount: 0,
			itemCount: 0,
		},
	];

	it("builds nested tree from flat nodes", () => {
		const tree = buildNestedTree(flat);
		expect(tree).toHaveLength(1);
		expect(tree[0].id).toBe(1);
		expect(tree[0].children).toHaveLength(1);
		expect(tree[0].children[0].children[0].id).toBe(3);
	});

	it("returns empty array for empty input", () => {
		expect(buildNestedTree([])).toEqual([]);
	});

	it("uses custom rootParentId", () => {
		expect(buildNestedTree(flat, 999)).toHaveLength(0);
	});
});

describe("createPage", () => {
	it("creates page with default values", async () => {
		insertValues.mockResolvedValue([{ insertId: 1 }]);
		await createPage({ parentId: 0, caption: "Test" });

		const data = insertValues.mock.calls[0][0];
		expect(data.caption).toBe("Test");
		expect(data.pageLayout).toBe("default_3x3");
		expect(data.visible).toBe("1");
		expect(data.enabled).toBe("1");
		expect(data.clubOnly).toBe("0");
		expect(data.minRank).toBe(1);
	});

	it("truncates captionSave to 25 chars", async () => {
		insertValues.mockResolvedValue([{ insertId: 1 }]);
		await createPage({ parentId: 0, caption: "a".repeat(50) });

		expect(insertValues.mock.calls[0][0].captionSave).toBe("a".repeat(25));
	});

	it("converts boolean visible/enabled to string", async () => {
		insertValues.mockResolvedValue([{ insertId: 1 }]);
		await createPage({
			parentId: 0,
			caption: "x",
			visible: false,
			enabled: false,
		});
		expect(insertValues.mock.calls[0][0].visible).toBe("0");
		expect(insertValues.mock.calls[0][0].enabled).toBe("0");
	});
});

describe("movePage", () => {
	it("uses the shared structural command", async () => {
		await movePage(1, 2);
		expect(commands.updatePageCommand).toHaveBeenCalledWith("normal", 1, {
			parentId: 2,
		});
	});
});

describe("getAncestors", () => {
	it("returns breadcrumb from root to page", async () => {
		selectLimit
			.mockResolvedValueOnce([{ id: 3, caption: "Grandchild", parentId: 2 }])
			.mockResolvedValueOnce([{ id: 2, caption: "Child", parentId: 1 }])
			.mockResolvedValueOnce([{ id: 1, caption: "Root", parentId: 0 }]);

		const ancestors = await getAncestors(3);
		expect(ancestors).toHaveLength(3);
		expect(ancestors[0].caption).toBe("Root");
		expect(ancestors[1].caption).toBe("Child");
		expect(ancestors[2].caption).toBe("Grandchild");
	});

	it("stops when page not found", async () => {
		selectLimit.mockResolvedValue([]);
		expect(await getAncestors(999)).toEqual([]);
	});
});

describe("deletePage", () => {
	it("uses the shared transactional delete", async () => {
		commands.deletePageCommand.mockResolvedValue({
			deletedPages: 1,
			movedChildren: 2,
		});
		expect(await deletePage(5, "reparent")).toEqual({
			deletedPages: 1,
			movedChildren: 2,
		});
		expect(commands.deletePageCommand).toHaveBeenCalledWith(
			"normal",
			5,
			"reparent",
		);
	});
});
