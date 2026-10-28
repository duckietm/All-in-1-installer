import { describe, expect, it } from "vitest";
import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import {
	buildSortOrders,
	groupSuggestedCategories,
	type SortStrategy,
	type SugFurni,
	type SugFurniEntry,
	sortCatalogItems,
	suggestCatalogIcon,
	suggestCatalogLayout,
	suggestCatalogLayoutFromBaseItems,
	suggestCategoryName,
} from "./organize";

function offer(overrides: Partial<CatalogItemData> = {}): CatalogItemData {
	return {
		id: 1,
		catalogName: "",
		itemIds: "1",
		costCredits: 0,
		costPoints: 0,
		pointsType: 0,
		amount: 1,
		limitedSells: 0,
		limitedStack: 0,
		orderNumber: 0,
		offerId: -1,
		songId: 0,
		haveOffer: "1",
		clubOnly: "0",
		extradata: "",
		baseName: "",
		baseItemName: "",
		spriteId: 0,
		baseItem: null,
		...overrides,
	};
}

const sample = [
	offer({ id: 3, catalogName: "Zebra", costCredits: 10, limitedStack: 0 }),
	offer({ id: 1, catalogName: "Apple", costCredits: 5, limitedStack: 0 }),
	offer({ id: 2, catalogName: "Mango", costCredits: 5, limitedStack: 50 }),
];

describe("sortCatalogItems", () => {
	it("sorts by name ascending", () => {
		const sorted = sortCatalogItems(sample, "name-asc");
		expect(sorted.map((i) => i.id)).toEqual([1, 2, 3]);
	});

	it("sorts by name descending", () => {
		const sorted = sortCatalogItems(sample, "name-desc");
		expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
	});

	it("sorts by price then id", () => {
		const sorted = sortCatalogItems(sample, "price-asc");
		expect(sorted.map((i) => i.id)).toEqual([1, 2, 3]);
	});

	it("sorts expensive first", () => {
		const sorted = sortCatalogItems(sample, "price-desc");
		expect(sorted.map((i) => i.id)).toEqual([3, 1, 2]);
	});

	it("keeps limited editions first", () => {
		const sorted = sortCatalogItems(sample, "limited-first");
		expect(sorted.map((i) => i.id)).toEqual([2, 1, 3]);
	});

	it("keeps offers first", () => {
		const input = [
			offer({ id: 1, catalogName: "a", haveOffer: "0" }),
			offer({ id: 2, catalogName: "b", haveOffer: "1" }),
		];
		const sorted = sortCatalogItems(input, "offer-first");
		expect(sorted.map((i) => i.id)).toEqual([2, 1]);
	});

	it("sorts amount descending", () => {
		const input = [
			offer({ id: 1, catalogName: "a", amount: 1 }),
			offer({ id: 2, catalogName: "b", amount: 10 }),
		];
		const sorted = sortCatalogItems(input, "amount-desc");
		expect(sorted.map((i) => i.id)).toEqual([2, 1]);
	});

	it("is stable for unknown strategies", () => {
		const sorted = sortCatalogItems(sample, "name-asc" as SortStrategy);
		const re = sortCatalogItems([...sorted].reverse(), "name-asc");
		expect(re.map((i) => i.id)).toEqual([1, 2, 3]);
	});
});

describe("buildSortOrders", () => {
	it("assigns sequential order numbers", () => {
		const orders = buildSortOrders([sample[2], sample[0]]);
		expect(orders).toEqual([
			{ id: 2, orderNumber: 0 },
			{ id: 3, orderNumber: 1 },
		]);
	});
});

describe("suggestCatalogLayout", () => {
	it("returns null for empty lists", () => {
		expect(suggestCatalogLayout([])).toBeNull();
	});

	it("suggests soundmachine when songs present", () => {
		const input = [
			offer({ songId: 55, baseItem: { interactionType: "default" } as never }),
		];
		expect(suggestCatalogLayout(input)?.layout).toBe("soundmachine");
	});

	it("suggests pets when base item type is 'p'", () => {
		const input = [offer({ baseItem: { type: "p" } as never })];
		expect(suggestCatalogLayout(input)?.layout).toBe("pets");
	});

	it("suggests trophies for trophy interactions", () => {
		const input = [offer({ baseItem: { interactionType: "trophy" } as never })];
		expect(suggestCatalogLayout(input)?.layout).toBe("trophies");
	});

	it("suggests guilds for guild interactions", () => {
		const input = [offer({ baseItem: { interactionType: "guild" } as never })];
		expect(suggestCatalogLayout(input)?.layout).toBe("guilds");
	});

	it("returns null when no strong signal", () => {
		const input = [
			offer({ baseItem: { interactionType: "default" } as never }),
		];
		expect(suggestCatalogLayout(input)).toBeNull();
	});
});

describe("suggestCatalogLayoutFromBaseItems", () => {
	it("returns null for empty lists", () => {
		expect(suggestCatalogLayoutFromBaseItems([])).toBeNull();
	});

	it("suggests soundmachine from interaction type", () => {
		expect(
			suggestCatalogLayoutFromBaseItems([{ interactionType: "soundmachine" }])
				?.layout,
		).toBe("soundmachine");
	});

	it("suggests pets from base type", () => {
		expect(
			suggestCatalogLayoutFromBaseItems([
				{ type: "p", interactionType: "default" },
			])?.layout,
		).toBe("pets");
	});

	it("suggests trophies for trophy interactions", () => {
		expect(
			suggestCatalogLayoutFromBaseItems([{ interactionType: "trophy" }])
				?.layout,
		).toBe("trophies");
	});

	it("returns null when no strong signal", () => {
		expect(
			suggestCatalogLayoutFromBaseItems([{ interactionType: "default" }]),
		).toBeNull();
	});
});

function fum(itemName?: string, interactionType?: string): SugFurni {
	return { itemName, interactionType };
}

describe("suggestCategoryName", () => {
	it("returns null for empty lists", () => {
		expect(suggestCategoryName([])).toBeNull();
	});

	it("derives a pluralized label from the dominant classname token", () => {
		const input = [fum("chair_wooden"), fum("chair_oak"), fum("chair_polyfon")];
		expect(suggestCategoryName(input)).toBe("Chairs");
	});

	it("keeps singular-only tokens singular", () => {
		expect(suggestCategoryName([fum("wallpaper_leaf")])).toBe("Wallpaper");
		expect(suggestCategoryName([fum("floor_plain")])).toBe("Floor");
	});

	it("prefers interaction labels over classname tokens", () => {
		const input = [
			fum("trophy_cup", "trophy"),
			fum("trophy_crown", "trophy"),
			fum("chair_oak", "default"),
		];
		expect(suggestCategoryName(input)).toBe("Trophies");
	});

	it("uses the last-resort mapping for known interactions", () => {
		expect(
			suggestCategoryName([fum("soundmachine_flat", "soundmachine")]),
		).toBe("Sounds");
	});

	it("returns null when nothing can be derived", () => {
		expect(suggestCategoryName([fum("")])).toBeNull();
	});
});

describe("suggestCatalogIcon", () => {
	it("returns 0 for unknown categories", () => {
		expect(suggestCatalogIcon([fum("")])).toBe(0);
	});

	it("maps detected categories to a catalog icon id", () => {
		expect(suggestCatalogIcon([fum("chair_oak")])).toBeGreaterThan(0);
		expect(suggestCatalogIcon([fum("trophy_cup", "trophy")])).toBe(7);
	});

	it("is deterministic", () => {
		const a = suggestCatalogIcon([fum("chair_oak"), fum("chair_oak")]);
		const b = suggestCatalogIcon([fum("chair_oak"), fum("chair_oak")]);
		expect(a).toBe(b);
	});
});

describe("groupSuggestedCategories", () => {
	function entry(
		id: number,
		itemName?: string,
		interactionType?: string,
	): SugFurniEntry {
		return { id, itemName, interactionType };
	}

	it("returns an empty list for no input", () => {
		expect(groupSuggestedCategories([])).toEqual([]);
	});

	it("groups furniture by shared label, largest group first", () => {
		const groups = groupSuggestedCategories([
			entry(1, "chair_wooden"),
			entry(2, "chair_oak"),
			entry(3, "sofa_polyfon"),
			entry(4, "chair_polyfon"),
		]);
		expect(groups.map((g) => g.name)).toEqual(["Chairs", "Sofas"]);
		expect(groups[0]?.items.map((i) => i.id)).toEqual([1, 2, 4]);
		expect(groups[1]?.items.map((i) => i.id)).toEqual([3]);
	});

	it("sorts by size then alphabetically on ties", () => {
		const groups = groupSuggestedCategories([
			entry(1, "sofa_polyfon"),
			entry(2, "chair_oak"),
		]);
		expect(groups.map((g) => g.name)).toEqual(["Chairs", "Sofas"]);
	});

	it("falls back deterministically and drops nothing", () => {
		const groups = groupSuggestedCategories([
			entry(1, "sofa_polyfon"),
			entry(2, ""),
			entry(3, ""),
		]);
		expect(groups.map((g) => g.name)).toEqual(["Other Furni", "Sofas"]);
		const leftover = groups.find((g) => g.name === "Other Furni");
		expect(leftover?.items.map((i) => i.id)).toEqual([2, 3]);
		expect(leftover).not.toBeNull();
	});

	it("suggests a plausible icon and layout per group", () => {
		const groups = groupSuggestedCategories([entry(1, "chair_oak")]);
		expect(groups[0]).toBeDefined();
		expect(groups[0]?.icon).toBeGreaterThan(0);
	});

	it("uses the same label as the batch name suggestion", () => {
		const group = groupSuggestedCategories([
			entry(1, "trophy_cup", "trophy"),
			entry(2, "trophy_crown", "trophy"),
			entry(3, "chair_oak"),
		])[0];
		expect(group?.name).toBe("Trophies");
	});

	it("detects special keyword groups like NFTs, Dragons, and Lasers", () => {
		const groups = groupSuggestedCategories([
			entry(1, "nft_trophy_gold"),
			entry(2, "nft_avatar_statue"),
			entry(3, "dragon_fire_lamp"),
			entry(4, "laser_gate_cyan"),
		]);
		expect(groups.map((g) => g.name)).toContain("NFTs");
		expect(groups.map((g) => g.name)).toContain("Dragons");
		expect(groups.map((g) => g.name)).toContain("Lasers");
		const nftGroup = groups.find((g) => g.name === "NFTs");
		expect(nftGroup?.items.map((i) => i.id)).toEqual([1, 2]);
	});
});
