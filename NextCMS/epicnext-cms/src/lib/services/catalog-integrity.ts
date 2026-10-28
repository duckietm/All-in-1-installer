import {
	offerInteger,
	parseFurnitureIds,
} from "@/features/catalog/domain/offer-input";
import {
	assetNameCandidates,
	classifyCatalogItem,
	NO_ASSET_KINDS,
} from "./item-kind";

export type IntegrityCatalog = "normal" | "bc";
export interface IntegrityPage {
	id: number;
	parentId: number;
	caption: string;
}
export interface IntegrityItem {
	id: number;
	item_name: string;
	public_name: string;
	type: string;
	interaction_type?: string | null;
}
export interface IntegrityOffer {
	id: number;
	pageId: number;
	itemIds: string;
	name: string;
	offerId: number | null;
}
export type IntegrityCode =
	| "missing_furniture"
	| "invalid_item_ids"
	| "missing_page"
	| "unreachable_page"
	| "category_cycle"
	| "missing_icon"
	| "invalid_offer_id"
	| "duplicate_offer_id";
export interface IntegrityIssue {
	code: IntegrityCode;
	id: number;
	name: string;
	detail: string;
	href: string;
}
export interface ParentRepair {
	id: number;
	caption: string;
	from: number;
	to: -1;
}

export function integrityCatalog(value: unknown): IntegrityCatalog {
	if (value !== "normal" && value !== "bc") throw new Error("Invalid catalog");
	return value;
}

/** Only missing parents have an unambiguous, record-preserving repair. */
export function planParentRepairs(pages: IntegrityPage[]): ParentRepair[] {
	const ids = new Set(pages.map((page) => page.id));
	return pages
		.filter((page) => page.parentId > 0 && !ids.has(page.parentId))
		.map((page) => ({
			id: page.id,
			caption: page.caption,
			from: page.parentId,
			to: -1 as const,
		}))
		.sort((a, b) => a.id - b.id);
}

export function inspectCatalogIntegrity(input: {
	catalog: IntegrityCatalog;
	pages: IntegrityPage[];
	items: IntegrityItem[];
	offers: IntegrityOffer[];
	icons: Set<string> | null;
}): {
	issues: IntegrityIssue[];
	counts: Partial<Record<IntegrityCode, number>>;
	total: number;
	iconsAvailable: boolean;
} {
	const issues: IntegrityIssue[] = [];
	const pageMap = new Map(input.pages.map((page) => [page.id, page]));
	const items = new Set(input.items.map((item) => item.id));
	const base =
		input.catalog === "bc" ? "/admin/catalog/builder-club" : "/admin/catalog";
	const state = new Map<
		number,
		"reachable" | "unreachable_page" | "category_cycle"
	>();
	// Iterative traversal avoids stack overflow on deep imported catalogs.
	for (const page of input.pages) {
		const chain: number[] = [];
		const visiting = new Set<number>();
		let current = page.id;
		let result: "reachable" | "unreachable_page" | "category_cycle" =
			"reachable";
		while (current > 0) {
			const known = state.get(current);
			if (known) {
				result = known;
				break;
			}
			if (visiting.has(current)) {
				result = "category_cycle";
				break;
			}
			const node = pageMap.get(current);
			if (!node) {
				result = "unreachable_page";
				break;
			}
			visiting.add(current);
			chain.push(current);
			current = node.parentId;
		}
		for (const id of chain) state.set(id, result);
	}
	for (const page of input.pages) {
		const code = state.get(page.id);
		if (code && code !== "reachable")
			issues.push({
				code,
				id: page.id,
				name: page.caption,
				detail: String(page.parentId),
				href: `${base}/${page.id}`,
			});
	}
	const offerIds = new Map<number, number>();
	for (const offer of input.offers)
		if (offer.offerId !== null && offer.offerId > 0)
			offerIds.set(offer.offerId, (offerIds.get(offer.offerId) ?? 0) + 1);
	for (const offer of input.offers) {
		const href = pageMap.has(offer.pageId)
			? `${base}/${offer.pageId}`
			: `${base}?view=table&search=${offer.id}`;
		const add = (code: IntegrityCode, detail: string) => {
			issues.push({ code, id: offer.id, name: offer.name, detail, href });
		};
		// Non-positive placement IDs may represent unlisted/system offers. Only missing positive category references are actionable.
		if (offer.pageId > 0 && !pageMap.has(offer.pageId))
			add("missing_page", String(offer.pageId));
		const tokens = String(offer.itemIds ?? "")
			.split(";")
			.map((token) => token.trim());
		try {
			parseFurnitureIds(String(offer.itemIds ?? ""));
		} catch {
			add("invalid_item_ids", String(offer.itemIds ?? ""));
		}

		const missing = [
			...new Set(
				tokens.filter(
					(token) =>
						/^\d+$/.test(token) &&
						Number(token) > 0 &&
						Number.isSafeInteger(Number(token)) &&
						!items.has(Number(token)),
				),
			),
		];
		if (missing.length) add("missing_furniture", missing.join(";"));
		// Match the editor contract: zero and signed special values (including default -1) survive unchanged.
		if (
			offer.offerId !== null &&
			!offerInteger.safeParse(offer.offerId).success
		)
			add("invalid_offer_id", String(offer.offerId));
		else if (offer.offerId !== null && (offerIds.get(offer.offerId) ?? 0) > 1)
			add("duplicate_offer_id", String(offer.offerId));
	}
	if (input.icons)
		for (const item of input.items) {
			if (NO_ASSET_KINDS.has(classifyCatalogItem(item))) continue;
			if (
				!assetNameCandidates(item.item_name, item.public_name).icon.some(
					(name) => input.icons?.has(name),
				)
			)
				issues.push({
					code: "missing_icon",
					id: item.id,
					name: item.public_name || item.item_name,
					detail: item.item_name,
					href: `/admin/items/${item.id}`,
				});
		}
	const counts: Partial<Record<IntegrityCode, number>> = {};
	for (const issue of issues)
		counts[issue.code] = (counts[issue.code] ?? 0) + 1;
	return {
		issues: issues.slice(0, 200),
		counts,
		total: issues.length,
		iconsAvailable: input.icons !== null,
	};
}
