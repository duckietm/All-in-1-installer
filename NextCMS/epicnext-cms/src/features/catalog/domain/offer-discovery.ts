import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";

export const OFFER_FILTERS = [
	"all",
	"free",
	"paid",
	"bundles",
	"limited",
	"club_only_yes",
	"club_only_no",
	"have_offer_yes",
	"have_offer_no",
] as const;
export type OfferFilter = (typeof OFFER_FILTERS)[number];
type DiscoverableOffer = Pick<
	CatalogItemData,
	| "id"
	| "catalogName"
	| "baseItemName"
	| "baseName"
	| "itemIds"
	| "costCredits"
	| "costPoints"
	| "limitedStack"
> & {
	clubOnly?: string;
	haveOffer?: string;
};

function matchesFilter(item: DiscoverableOffer, filter: OfferFilter) {
	switch (filter) {
		case "all":
			return true;
		case "free":
			return item.costCredits === 0 && item.costPoints === 0;
		case "paid":
			return item.costCredits > 0 || item.costPoints > 0;
		case "bundles":
			return (
				item.itemIds.split(";").filter((part) => part.trim().length > 0)
					.length > 1
			);
		case "limited":
			return item.limitedStack > 0;
		case "club_only_yes":
			return item.clubOnly === "1";
		case "club_only_no":
			return item.clubOnly === "0";
		case "have_offer_yes":
			return item.haveOffer === "1";
		case "have_offer_no":
			return item.haveOffer === "0";
	}
}

/** Facet counts apply to the text search so changing a facet never hides its available matches. */
export function discoverOffers<T extends DiscoverableOffer>(
	items: readonly T[],
	query: string,
	filters: Record<string, string>,
) {
	const normalized = query.trim().toLowerCase();
	const exactId = /^#\d+$/.test(normalized) ? normalized.slice(1) : null;

	let matches = items;

	// Apply text search
	if (exactId !== null) {
		matches = matches.filter((item) => String(item.id) === exactId);
	} else if (normalized) {
		matches = matches.filter((item) =>
			[
				item.catalogName,
				item.baseItemName,
				item.baseName,
				item.itemIds,
				String(item.id),
			].some((value) => value.toLowerCase().includes(normalized)),
		);
	}

	// Calculate facet counts based on *all* items matching the text query, before specific filters are applied
	const initialMatchesForFacets = items.filter((item) => {
		if (exactId !== null) return String(item.id) === exactId;
		if (normalized)
			return [
				item.catalogName,
				item.baseItemName,
				item.baseName,
				item.itemIds,
				String(item.id),
			].some((value) => value.toLowerCase().includes(normalized));
		return true; // If no text query, all items are initial matches
	});

	const allCount = initialMatchesForFacets.length;

	// Apply multiple filters
	for (const filterKey in filters) {
		const filterValue = filters[filterKey];
		if (filterValue && filterValue !== "all") {
			matches = matches.filter((item) =>
				matchesFilter(item, filterValue as OfferFilter),
			);
		}
	}

	const counts = {
		all: allCount,
		free: 0,
		paid: 0,
		bundles: 0,
		limited: 0,
		club_only_yes: 0,
		club_only_no: 0,
		have_offer_yes: 0,
		have_offer_no: 0,
	};

	for (const item of initialMatchesForFacets) {
		for (const facet of OFFER_FILTERS) {
			if (facet !== "all" && matchesFilter(item, facet)) counts[facet] += 1;
		}
	}

	// The `items` property in the return object should now be the fully filtered `matches`.
	return {
		items: matches,
		counts,
	};
}
