import type { CatalogItemData } from "@/components/admin/catalog/catalog-items-table/types";
import type { CatalogLayout } from "@/lib/catalog-layouts";

export type SortStrategy =
	| "name-asc"
	| "name-desc"
	| "price-asc"
	| "price-desc"
	| "limited-first"
	| "offer-first"
	| "amount-desc";

export const SORT_STRATEGIES: Array<{ id: SortStrategy; label: string }> = [
	{ id: "name-asc", label: "Name A → Z" },
	{ id: "name-desc", label: "Name Z → A" },
	{ id: "price-asc", label: "Cheapest first" },
	{ id: "price-desc", label: "Most expensive first" },
	{ id: "limited-first", label: "Limited editions first" },
	{ id: "offer-first", label: "Offers first" },
	{ id: "amount-desc", label: "Largest stack first" },
];

function offerPrice(item: CatalogItemData): number {
	return item.costCredits + item.costPoints;
}

function offerName(item: CatalogItemData): string {
	return (item.catalogName || item.baseName || `#${item.id}`).toLowerCase();
}

function compareBook(a: string, b: string): number {
	return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Deterministically order a page's offers for a chosen strategy.
 * Unstable collations are resolved by id so the result is reproducible.
 */
export function sortCatalogItems(
	items: CatalogItemData[],
	strategy: SortStrategy,
): CatalogItemData[] {
	const sorted = [...items].sort((a, b) => {
		switch (strategy) {
			case "name-asc":
				return compareBook(offerName(a), offerName(b)) || a.id - b.id;
			case "name-desc":
				return compareBook(offerName(b), offerName(a)) || a.id - b.id;
			case "price-asc":
				return offerPrice(a) - offerPrice(b) || a.id - b.id;
			case "price-desc":
				return offerPrice(b) - offerPrice(a) || a.id - b.id;
			case "limited-first": {
				const altd = a.limitedStack > 0 ? 0 : 1;
				const bltd = b.limitedStack > 0 ? 0 : 1;
				return altd - bltd || b.limitedStack - a.limitedStack || a.id - b.id;
			}
			case "offer-first": {
				const aoff = a.haveOffer === "1" ? 0 : 1;
				const boff = b.haveOffer === "1" ? 0 : 1;
				return aoff - boff || a.id - b.id;
			}
			case "amount-desc":
				return b.amount - a.amount || a.id - b.id;
			default:
				return a.id - b.id;
		}
	});
	return sorted;
}

/** Emit `order_number` assignments (sequential from 0) for a new order. */
export function buildSortOrders(items: CatalogItemData[]): Array<{
	id: number;
	orderNumber: number;
}> {
	return items.map((item, index) => ({
		id: item.id,
		orderNumber: index,
	}));
}

export interface LayoutSuggestion {
	layout: CatalogLayout;
	reason: string;
}

/** Strong, deterministic signals only — never suggest when unsure. */
export function suggestCatalogLayout(
	items: CatalogItemData[],
): LayoutSuggestion | null {
	if (items.length === 0) return null;

	const interactions = new Set(
		items.map((i) => i.baseItem?.interactionType ?? "").filter(Boolean),
	);
	const types = new Set(items.map((i) => i.baseItem?.type ?? ""));
	const anySong = items.some((i) => i.songId > 0);

	return layoutFromSignals({ interactions, types, anySong });
}

function layoutFromSignals(params: {
	interactions: Set<string>;
	types: Set<string>;
	anySong: boolean;
}): LayoutSuggestion | null {
	const { interactions, types, anySong } = params;

	if (anySong || interactions.has("soundmachine"))
		return {
			layout: "soundmachine",
			reason: "contains songs / soundmachine items",
		};

	if (types.has("p")) return { layout: "pets", reason: "contains pets" };
	if (interactions.has("pet"))
		return { layout: "pets2", reason: "contains pet wear/pets" };

	if (interactions.has("trophy"))
		return { layout: "trophies", reason: "contains trophies" };

	if (interactions.has("guild"))
		return { layout: "guilds", reason: "contains guild items" };

	return null;
}

/** Layout suggestion using base-item fields directly (for the auto-category wizard). */
export function suggestCatalogLayoutFromBaseItems(
	items: Array<{ type?: string | null; interactionType?: string | null }>,
): LayoutSuggestion | null {
	if (items.length === 0) return null;
	const interactions = new Set(
		items.map((i) => i.interactionType ?? "").filter(Boolean),
	);
	const types = new Set(items.map((i) => i.type ?? ""));
	return layoutFromSignals({ interactions, types, anySong: false });
}

// ── Auto-category suggestion helpers ──────────────────────────

export interface SugFurni {
	itemName?: string | null;
	publicName?: string | null;
	type?: string | null;
	interactionType?: string | null;
}

const THEME_PREFIXES = new Set([
	"a",
	"habbo",
	"hween",
	"boo",
	"xmas",
	"easter",
	"summer",
	"santorini",
	"marquee",
	"val",
	"bf",
	"ny",
	"lonely",
	"hotel",
	"expo",
	"tiki",
	"jungle",
	"dino",
	"factory",
	"champions",
	"f1",
	"bubble",
	"ice",
	"beach",
	"country",
	"modern",
	"elegant",
	"gothic",
	"fanti",
	"rock",
	"disco",
	"spa",
	"rainy",
	"skel",
	"vampire",
	"ninja",
	"pirate",
	"royal",
	"space",
	"wild",
	"woody",
	"zen",
]);

const INTERACTION_LABELS: Record<string, string> = {
	soundmachine: "Sounds",
	jukebox: "Sounds",
	trophy: "Trophies",
	pet: "Pets",
	guild: "Guilds",
	dimmer: "Lighting",
	bed: "Beds",
	chair: "Chairs",
	table: "Tables",
	roller: "Rollers",
	vending: "Vending",
	poster: "Posters",
	wallpaper: "Wallpaper",
	floor: "Floor",
	teleport: "Teleports",
	dice: "Dice",
	sticky: "Stickies",
	football: "Football",
	mannequin: "Clothing",
	clothing: "Clothing",
	magicbox: "Magic Items",
	freeze: "Freeze",
	furni: "Furni",
	default: "",
};

const KEEP_SINGULAR = new Set([
	"wallpaper",
	"floor",
	"poster",
	"rug",
	"sauna",
	"teleport",
	"clothing",
	"pool",
	"garden",
	"park",
	"city",
	"hotel",
	"surface",
	"fx",
	"clothing",
]);

const THEME_SUFFIXES = new Set([
	"hween",
	"xmas",
	"easter",
	"summer",
	"val",
	"bf",
	"ny",
]);

function classToken(item: SugFurni): string | null {
	const raw = (item.itemName || "").split("/")[0]?.trim() || "";
	if (!raw) return null;
	const first = raw.split("_")[0]?.toLowerCase();
	if (!first || THEME_PREFIXES.has(first) || THEME_SUFFIXES.has(first))
		return null;
	return first;
}

function pluralizeLabel(token: string): string {
	const lower = token.toLowerCase();
	const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
	if (KEEP_SINGULAR.has(lower)) return cap;
	if (/(?:s|ss|sh|ch|x|z)$/.test(lower) && lower.length > 3) return cap;
	return `${cap}s`;
}

/**
 * Per-item category label used by both the batch name suggestion and the
 * import grouping. Interaction labels win over classname tokens; falls back to
 * the classname token when nothing stronger is detected.
 */
function unitLabel(item: SugFurni): string | null {
	const name = (item.itemName || "").toLowerCase();
	const pub = (item.publicName || "").toLowerCase();
	if (name.includes("nft") || pub.includes("nft")) return "NFTs";
	if (name.includes("dragon") || pub.includes("dragon")) return "Dragons";
	if (name.includes("laser") || pub.includes("laser")) return "Lasers";
	if (name.includes("roller") || pub.includes("roller")) return "Rollers";

	const inter = item.interactionType?.toLowerCase();
	let label: string | undefined;
	if (inter && inter !== "default") {
		label = INTERACTION_LABELS[inter];
	}
	if (!label) {
		const token = classToken(item);
		if (token) label = pluralizeLabel(token);
	}
	return label ?? null;
}

/**
 * Best-effort English category label derived from a batch of base items.
 * Never blocks — returns null when it can't determine anything useful.
 */
export function suggestCategoryName(furni: SugFurni[]): string | null {
	if (furni.length === 0) return null;

	const labelCounts = new Map<string, number>();
	for (const f of furni) {
		const label = unitLabel(f);
		if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
	}

	const sorted = [...labelCounts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	return sorted[0]?.[0] ?? null;
}

/**
 * Curated mapping from category labels to catalog icon IDs.
 * All IDs are known to exist in the standard gamedata icon set (1–326).
 */
const CATEGORY_ICON_MAP: Record<string, number> = {
	Sounds: 6,
	Pets: 8,
	Trophies: 7,
	Guilds: 3,
	Wallpaper: 4,
	Floor: 5,
	Lighting: 9,
	Posters: 2,
	Chairs: 10,
	Beds: 11,
	Tables: 12,
	Rollers: 13,
	Vending: 14,
	Teleports: 15,
	Dice: 16,
	Stickies: 17,
	Football: 18,
	Clothing: 19,
	"Magic Items": 20,
	Freeze: 21,
	Furni: 22,
};

/**
 * Suggest a catalog icon ID based on detected category.
 * Returns 0 when it can't determine a sensible icon.
 */
export function suggestCatalogIcon(furni: SugFurni[]): number {
	const name = suggestCategoryName(furni);
	if (!name) return 0;
	return CATEGORY_ICON_MAP[name] ?? 1;
}

// ── Import organization grouping ─────────────────────────────

export type SugFurniEntry = SugFurni & { id: number };

export interface SuggestedFurniGroup<T extends SugFurniEntry = SugFurniEntry> {
	name: string;
	icon: number;
	layout: LayoutSuggestion | null;
	items: T[];
}

const REMAINDER_LABEL = "Other Furni";

/**
 * Group furniture into suggested catalog categories. Every item keeps its
 * deterministic per-item label, so the same logic drives the batch name
 * suggestion and the grouping. Furniture that can't be labeled is collected
 * into a single remainder group so nothing is ever dropped.
 * Groups are ordered by size (largest first) and alphabetically on ties.
 */
export function groupSuggestedCategories<T extends SugFurniEntry>(
	entries: T[],
): SuggestedFurniGroup<T>[] {
	const buckets = new Map<string, T[]>();
	for (const entry of entries) {
		const key = unitLabel(entry) ?? REMAINDER_LABEL;
		buckets.set(key, [...(buckets.get(key) ?? []), entry]);
	}

	const groups: SuggestedFurniGroup<T>[] = [];
	for (const [name, items] of buckets) {
		const sortedItems = [...items].sort((a, b) => a.id - b.id);
		groups.push({
			name,
			icon: CATEGORY_ICON_MAP[name] ?? 1,
			layout: suggestCatalogLayoutFromBaseItems(sortedItems),
			items: sortedItems,
		});
	}

	return groups.sort(
		(a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name),
	);
}
