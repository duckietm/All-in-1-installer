import { describe, expect, it } from "vitest";
import { discoverOffers } from "./offer-discovery";

const offers = [
	{
		id: 7,
		catalogName: "Oak chair",
		baseItemName: "chair_oak",
		baseName: "Wooden chair",
		itemIds: "10",
		costCredits: 0,
		costPoints: 0,
		limitedStack: 0,
		clubOnly: "0",
		haveOffer: "0",
	},
	{
		id: 8,
		catalogName: "Chair pair",
		baseItemName: "",
		baseName: "",
		itemIds: "10;11",
		costCredits: 0,
		costPoints: 5,
		limitedStack: 0,
		clubOnly: "0",
		haveOffer: "1",
	},
	{
		id: 9,
		catalogName: "Limited table",
		baseItemName: "table_oak",
		baseName: "Wooden table",
		itemIds: "12",
		costCredits: 15,
		costPoints: 0,
		limitedStack: 100,
		clubOnly: "1",
		haveOffer: "0",
	},
	{
		id: 10,
		catalogName: "Welcome bundle",
		baseItemName: "",
		baseName: "",
		itemIds: " 10 ; 12 ",
		costCredits: 0,
		costPoints: 0,
		limitedStack: 0,
		clubOnly: "0",
		haveOffer: "0",
	},
];

describe("offer discovery", () => {
	it("matches #offer IDs exactly without matching longer IDs or furniture references", () => {
		const rows = [offers[0], { ...offers[1], id: 17, itemIds: "7" }];
		expect(
			discoverOffers(rows, " #7 ", { offerFilter: "all" }).items.map(
				(item) => item.id,
			),
		).toEqual([7]);
	});
	it("requires both prices to be zero for free offers and includes points-only paid offers", () => {
		expect(
			discoverOffers(offers, "", { offerFilter: "free" }).items.map(
				(item) => item.id,
			),
		).toEqual([7, 10]);
		expect(
			discoverOffers(offers, "", { offerFilter: "paid" }).items.map(
				(item) => item.id,
			),
		).toEqual([8, 9]);
	});
	it("recognizes semicolon bundles without requiring a single base item", () => {
		expect(
			discoverOffers(offers, "", { offerFilter: "bundles" }).items.map(
				(item) => item.id,
			),
		).toEqual([8, 10]);
		expect(
			discoverOffers([{ ...offers[0], itemIds: "10; ;" }], "", {
				offerFilter: "bundles",
			}).items,
		).toEqual([]);
	});
	it("identifies limited editions by stock even without sold quantities", () => {
		expect(
			discoverOffers(offers, "", { offerFilter: "limited" }).items.map(
				(item) => item.id,
			),
		).toEqual([9]);
	});
	it("combines trimmed case-insensitive text with a facet while counting other available facets", () => {
		const result = discoverOffers(offers, " CHAIR ", { offerFilter: "paid" });
		expect(result.items.map((item) => item.id)).toEqual([8]);
		expect(result.counts).toEqual({
			all: 2,
			free: 1,
			paid: 1,
			bundles: 1,
			limited: 0,
			club_only_yes: 0,
			club_only_no: 2,
			have_offer_yes: 1,
			have_offer_no: 1,
		});
	});
	it("searches public names, classnames, offer IDs and furniture references", () => {
		expect(
			discoverOffers(offers, "Wooden", { offerFilter: "all" }).items.map(
				(item) => item.id,
			),
		).toEqual([7, 9]);
		expect(
			discoverOffers(offers, "table_oak", { offerFilter: "all" }).items.map(
				(item) => item.id,
			),
		).toEqual([9]);
		expect(
			discoverOffers(offers, "7", { offerFilter: "all" }).items.map(
				(item) => item.id,
			),
		).toEqual([7]);
		expect(
			discoverOffers(offers, "11", { offerFilter: "all" }).items.map(
				(item) => item.id,
			),
		).toEqual([8]);
	});
	it("keeps source ordering and returns empty counts when the query has no matches", () => {
		const copy = structuredClone(offers);
		expect(discoverOffers(offers, " ", { offerFilter: "all" }).items).toEqual(
			offers,
		);
		expect(discoverOffers(offers, "absent", { offerFilter: "all" })).toEqual({
			items: [],
			counts: {
				all: 0,
				free: 0,
				paid: 0,
				bundles: 0,
				limited: 0,
				club_only_yes: 0,
				club_only_no: 0,
				have_offer_yes: 0,
				have_offer_no: 0,
			},
		});
		expect(offers).toEqual(copy);
	});
});
