// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	type IntegrityPage,
	inspectCatalogIntegrity,
	planParentRepairs,
} from "./catalog-integrity";

const pages: IntegrityPage[] = [
	{ id: 1, parentId: -1, caption: "Root" },
	{ id: 2, parentId: 999, caption: "Missing parent" },
	{ id: 3, parentId: 2, caption: "Child" },
	{ id: 4, parentId: 5, caption: "Cycle A" },
	{ id: 5, parentId: 4, caption: "Cycle B" },
	{ id: 6, parentId: 0, caption: "Root zero" },
];
describe("catalog integrity", () => {
	it("distinguishes missing-parent descendants, cycles and valid roots without proposing destructive fixes", () => {
		const result = inspectCatalogIntegrity({
			catalog: "normal",
			pages,
			items: [],
			offers: [],
			icons: new Set(),
		});
		expect(result.counts).toEqual({ unreachable_page: 2, category_cycle: 2 });
		expect(planParentRepairs(pages)).toEqual([
			{ id: 2, caption: "Missing parent", from: 999, to: -1 },
		]);
		expect(pages[1].parentId).toBe(999);
	});
	it("reports empty/malformed item lists, missing furniture and repeated offer IDs", () => {
		const result = inspectCatalogIntegrity({
			catalog: "normal",
			pages,
			items: [],
			icons: null,
			offers: [
				{
					id: 10,
					pageId: 1,
					itemIds: "2;garbage;0;3.5",
					name: "Bundle",
					offerId: 8,
				},
				{ id: 11, pageId: 999, itemIds: "", name: "Broken", offerId: 8 },
			],
		});
		expect(result.counts.missing_furniture).toBe(1);
		expect(result.counts.invalid_item_ids).toBe(2);
		expect(result.counts.duplicate_offer_id).toBe(2);
		expect(result.counts.missing_page).toBe(1);
		expect(result.iconsAvailable).toBe(false);
		expect(
			result.issues.find((issue) => issue.code === "missing_furniture")?.detail,
		).toBe("2");
	});
	it("checks actual icon candidates, excludes special item kinds and preserves BC detail paths", () => {
		const result = inspectCatalogIntegrity({
			catalog: "bc",
			pages: [pages[1]],
			offers: [],
			icons: new Set(["chair_icon.png"]),
			items: [
				{ id: 1, item_name: "chair", public_name: "Chair", type: "s" },
				{ id: 2, item_name: "table", public_name: "Table", type: "s" },
				{ id: 3, item_name: "badge", public_name: "Badge", type: "b" },
			],
		});
		expect(result.counts.missing_icon).toBe(1);
		expect(result.issues[0].href).toBe("/admin/catalog/builder-club/2");
	});
	it("preserves default and special offer IDs plus intentionally unlisted placements", () => {
		const result = inspectCatalogIntegrity({
			catalog: "normal",
			pages: [],
			icons: null,
			items: [{ id: 1, item_name: "chair", public_name: "Chair", type: "s" }],
			offers: [-1, 0, -10, -2147483648].map((offerId, index) => ({
				id: index + 1,
				pageId: index % 2 ? 0 : -1,
				itemIds: "001",
				name: "System offer",
				offerId,
			})),
		});
		expect(result.issues).toEqual([]);
		expect(result.counts.invalid_offer_id).toBeUndefined();
		expect(result.counts.duplicate_offer_id).toBeUndefined();
		expect(result.counts.missing_page).toBeUndefined();
	});
	it("still detects malformed offer IDs and missing positive category references", () => {
		const result = inspectCatalogIntegrity({
			catalog: "normal",
			pages: [],
			icons: null,
			items: [{ id: 1, item_name: "chair", public_name: "Chair", type: "s" }],
			offers: [1.5, 2147483648].map((offerId, index) => ({
				id: index + 1,
				pageId: 999,
				itemIds: "1",
				name: "Broken",
				offerId,
			})),
		});
		expect(result.counts.invalid_offer_id).toBe(2);
		expect(result.counts.missing_page).toBe(2);
	});

	it("handles deep catalog paths iteratively and caps the returned issue detail", () => {
		const deep = Array.from({ length: 15000 }, (_, i) => ({
			id: i + 1,
			caption: "Page",
			parentId: i === 14999 ? 99999 : i + 2,
		}));
		const result = inspectCatalogIntegrity({
			catalog: "normal",
			pages: deep,
			items: [],
			offers: [],
			icons: null,
		});
		expect(result.total).toBe(15000);
		expect(result.issues).toHaveLength(200);
		expect(planParentRepairs(deep)).toHaveLength(1);
	});
});
