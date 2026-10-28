import { bundleFileNames } from "@/lib/furni/bundle-file";

/**
 * Classification of `items_base` rows so the catalog audit and repairs know
 * exactly which items are expected to ship normal furni assets (`.hab`
 * bundles + `_icon.png` files) and which ones are special:
 *
 * - **badge** — stored with type `b`. Badges use album1584 `.gif` files and
 *   never ship furni `.nitro`/`_icon.png` assets. They are awarded, not
 *   purchased through the catalog.
 * - **pet** — pet purchase items (`a0 pet<N>`, interaction `pet<N>`). Pet
 *   assets live in the pet asset pipeline (`public/nitro-assets/bundled/pet`),
 *   not the furniture bundle dirs.
 * - **effect / bot / sticky** — system items with no furniture visuals at all.
 * - **poster** — poster furniture (`poster*` classnames, wall posters, novelty
 *   poster furni). Renders through the poster imager, so no `.nitro` / `_icon.png`
 *   assets are expected.
 * - **currency** — credit/pixel furniture (`CF_*`, `DF_*`). Renders through the
 *   currency imager (credits coin, badge-format exchange stickers), so no
 *   `.nitro` / `_icon.png` assets are expected.
 * - **furni** — everything else; must ship a `.nitro` and `_icon.png`.
 */

export type CatalogItemKind =
	| "badge"
	| "pet"
	| "effect"
	| "bot"
	| "sticky"
	| "poster"
	| "currency"
	| "furni";

export interface CatalogItemLike {
	type: string;
	item_name: string;
	interaction_type?: string | null;
}

/** Badges are stored in `items_base` with type `b`. */
export function isBadgeType(type: string): boolean {
	return type.trim().toLowerCase() === "b";
}

/** Pet purchase items use classnames like `a0 pet0` … `a0 pet80`. */
export function isPetClassname(itemName: string): boolean {
	return /^a0\s*pet\d+$/i.test(itemName.trim());
}

/** Pet purchase items use `pet<N>` as their interaction type. */
export function isPetInteraction(interactionType?: string | null): boolean {
	return /^pet\d+$/i.test((interactionType ?? "").trim());
}

/** Poster furniture classnames that have no `.nitro` asset expectations. */
export function isPosterClassname(itemName: string): boolean {
	const name = itemName.trim();
	if (/^poster\d+$/i.test(name)) return true;
	const POSTER_SPECIAL = new Set([
		"funtastic_four_poster",
		"duckfountain",
		"duckfountain2",
		"swimming",
	]);
	return POSTER_SPECIAL.has(name.toLowerCase());
}

/** Credit/pixel furniture (`CF_*`, `DF_*`) ships no `.nitro` assets. */
export function isCurrencyClassname(itemName: string): boolean {
	return /^(?:cf|df)_/i.test(itemName.trim());
}

/** Classify an `items_base` row into a catalog item kind. */
export function classifyCatalogItem(item: CatalogItemLike): CatalogItemKind {
	const name = item.item_name.trim();
	if (isBadgeType(item.type)) return "badge";
	if (isPetClassname(name) || isPetInteraction(item.interaction_type)) {
		return "pet";
	}
	if (/^avatar_effect/i.test(name)) return "effect";
	if (/^(bot_|rentable_bot_)/i.test(name)) return "bot";
	if (/^post[._]?it/i.test(name)) return "sticky";
	if (isPosterClassname(name)) return "poster";
	if (isCurrencyClassname(name)) return "currency";
	return "furni";
}

/** Kinds that never ship furni `.nitro` / `_icon.png` assets. */
export const NO_ASSET_KINDS: ReadonlySet<CatalogItemKind> = new Set([
	"badge",
	"pet",
	"effect",
	"bot",
	"sticky",
	"poster",
	"currency",
]);

/** Kinds that are not purchasable furniture and should not get catalog entries. */
export const NO_CATALOG_KINDS: ReadonlySet<CatalogItemKind> = new Set([
	"badge",
	"effect",
	"bot",
	"sticky",
]);

/**
 * Asset file names for a classname, mirroring how `importSingleFurni` writes
 * files. Returns `.nitro` and icon candidates (most specific first):
 * the exact classname, the star-variant base, the star→underscore name and the
 * dot→underscore name (`post.it` → `post_it.nitro`).
 *
 * When `publicName` is provided it is treated as an alternative classname (many
 * hotels store the real classname in `items_base.public_name` while `item_name`
 * holds a display name). Candidates from both names are merged and deduplicated.
 */
export function assetNameCandidates(
	classname: string,
	publicName?: string,
): {
	nitro: string[];
	icon: string[];
} {
	const unique = (names: string[]): string[] => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const n of names) {
			if (!n || seen.has(n)) continue;
			seen.add(n);
			out.push(n);
		}
		return out;
	};

	const starBase = classname.split("*")[0];
	const starUnderscore = classname.replace(/\*/g, "_");
	const dotUnderscore = classname.replace(/\./g, "_");

	const bases = [classname, starBase, dotUnderscore, starUnderscore];

	// Also try public_name when it looks like a real classname (no spaces,
	// not empty, not "0" which some hotels use as a "no value" marker).
	if (
		publicName &&
		publicName !== classname &&
		!publicName.includes(" ") &&
		publicName !== "0"
	) {
		const pnBase = publicName.split("*")[0];
		const pnStar = publicName.replace(/\*/g, "_");
		const pnDot = publicName.replace(/\./g, "_");
		bases.push(publicName, pnBase, pnDot, pnStar);
	}

	return {
		// Both bundle extensions per base — `.hab` first, legacy `.nitro` second,
		// so an item still resolves when only the older file is on disk.
		nitro: unique(bases).flatMap((n) => bundleFileNames(n)),
		icon: unique(bases).map((n) => `${n}_icon.png`),
	};
}
