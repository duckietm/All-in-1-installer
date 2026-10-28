import { describe, expect, it } from "vitest";
import {
	type OfferPurchasabilityInput,
	offerPurchasabilityProblems,
} from "./offer-purchasability";

function offer(over: Partial<OfferPurchasabilityInput> = {}) {
	return {
		pageEnabled: "1",
		pageVisible: "1",
		itemIds: "1234",
		amount: 1,
		costCredits: 10,
		costPoints: 0,
		offerId: 500,
		haveOffer: "1",
		furniId: 1234,
		...over,
	};
}

describe("offerPurchasabilityProblems", () => {
	it("accepts an offer the hotel can sell", () => {
		expect(offerPurchasabilityProblems(offer())).toEqual([]);
	});

	it("accepts a free offer and one without an offer id", () => {
		expect(offerPurchasabilityProblems(offer({ costCredits: 0 }))).toEqual([]);
		expect(offerPurchasabilityProblems(offer({ offerId: -1 }))).toEqual([]);
	});

	it("reports a page the client will not show", () => {
		expect(offerPurchasabilityProblems(offer({ pageVisible: "0" }))).toEqual([
			"catalog page is hidden",
		]);
		expect(offerPurchasabilityProblems(offer({ pageEnabled: "0" }))).toEqual([
			"catalog page is disabled",
		]);
	});

	it("reports item_ids that do not name the imported furni", () => {
		expect(offerPurchasabilityProblems(offer({ furniId: 9999 }))).toEqual([
			"item_ids does not contain furni id 9999 (it holds 1234)",
		]);
		expect(
			offerPurchasabilityProblems(offer({ itemIds: " 1234 ; 1235 " })),
		).toEqual([]);
		expect(offerPurchasabilityProblems(offer({ itemIds: "" }))).toEqual([
			"catalog item has no furni id in item_ids",
		]);
	});

	it("reports an offer that would deliver nothing", () => {
		expect(offerPurchasabilityProblems(offer({ amount: 0 }))).toEqual([
			"amount is 0, so the offer delivers nothing",
		]);
	});

	it("reports a negative price and a broken offer id", () => {
		expect(offerPurchasabilityProblems(offer({ costCredits: -1 }))).toEqual([
			"offer has a negative price",
		]);
		expect(offerPurchasabilityProblems(offer({ haveOffer: "0" }))).toEqual([
			"offer_id is set but haveOffer is not 1",
		]);
	});

	it("lists every problem at once", () => {
		expect(
			offerPurchasabilityProblems(
				offer({ pageVisible: "0", pageEnabled: "0", amount: 0 }),
			),
		).toEqual([
			"catalog page is disabled",
			"catalog page is hidden",
			"amount is 0, so the offer delivers nothing",
		]);
	});
});
