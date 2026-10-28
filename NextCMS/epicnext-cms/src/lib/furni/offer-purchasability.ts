/**
 * Why a catalog offer can be "imported successfully" and still be invisible in
 * the hotel.
 *
 * The import writes `catalog_items` plus a `furnidata` entry and reports `ok`.
 * Whether the emulator will actually sell the offer depends on a handful of
 * conditions the import never asserts: the page has to be enabled and visible,
 * `item_ids` has to name the furni id, `amount` has to be positive. Every one of
 * them looks fine in the CMS and produces a client that shows nothing, which is
 * reported as "the import did not work".
 *
 * This module is the pure part of that check so the rules can be tested without
 * a database; `importSingleFurni` supplies the row it read back.
 */

export interface OfferPurchasabilityInput {
	/** Catalog page the offer sits on. */
	pageEnabled: string;
	pageVisible: string;
	/** Raw `catalog_items.item_ids`, `;`-separated. */
	itemIds: string;
	amount: number;
	costCredits: number;
	costPoints: number;
	/** `-1` means the offer is not wired up. */
	offerId: number;
	haveOffer: string;
	/** The `catalog_item_base.id` the import just wrote. */
	furniId: number;
}

/** Offer id used by Habbo DBs for "this offer has no offer id". */
const NO_OFFER_ID = -1;

function parsesItemIds(itemIds: string): number[] {
	return itemIds
		.split(/[;,]/)
		.map((part) => Number(part.trim()))
		.filter((value) => Number.isFinite(value) && value > 0);
}

/** Problems that stop the hotel from selling the offer, in reporting order. */
export function offerPurchasabilityProblems(
	offer: OfferPurchasabilityInput,
): string[] {
	const problems: string[] = [];
	const ids = parsesItemIds(offer.itemIds);
	if (ids.length === 0) {
		problems.push("catalog item has no furni id in item_ids");
	} else if (!ids.includes(offer.furniId)) {
		problems.push(
			`item_ids does not contain furni id ${offer.furniId} (it holds ${ids.join(", ")})`,
		);
	}
	if (offer.pageEnabled !== "1") problems.push("catalog page is disabled");
	if (offer.pageVisible !== "1") problems.push("catalog page is hidden");
	if (!Number.isFinite(offer.amount) || offer.amount < 1)
		problems.push(`amount is ${offer.amount}, so the offer delivers nothing`);
	if (offer.costCredits < 0 || offer.costPoints < 0)
		problems.push("offer has a negative price");
	if (
		offer.offerId !== NO_OFFER_ID &&
		offer.haveOffer !== "1" &&
		ids.length > 0
	) {
		problems.push("offer_id is set but haveOffer is not 1");
	}
	return problems;
}
