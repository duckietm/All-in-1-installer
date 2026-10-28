/**
 * Client-safe auto-catalog helpers (pure, no Node/DB imports).
 *
 * Shared by the server-side import pipeline (furni-import.ts re-exports from
 * here) and the admin Studio UI, so the on-screen "auto category + auto price"
 * preview always matches what the emulator import actually applies.
 */

export interface AutoPrice {
	credits: number;
	points: number;
	pointsType: number;
}

export interface AutoCatalogPreview extends AutoPrice {
	categoryKey: string;
	categoryLabel: string;
}

// Catalog sub-page definitions (key = internal id used for caption_save `imp_<key>`)
export const CATEGORY_PAGE: Record<
	string,
	{ label: string; icon: number; order: number }
> = {
	credits: { label: "Credits & Exchange", icon: 263, order: 1 },
	rares: { label: "Rares", icon: 11, order: 2 },
	wired: { label: "Wired", icon: 1, order: 3 },
	nft: { label: "NFT", icon: 12, order: 4 },
	seasonal: { label: "Seasonal", icon: 10, order: 5 },
	music: { label: "Music & Sound", icon: 13, order: 6 },
	clothing: { label: "Clothing", icon: 3, order: 7 },
	builders: { label: "Builders Club", icon: 7, order: 8 },
	walls: { label: "Wall Items", icon: 5, order: 9 },
	promo: { label: "Promo & Custom", icon: 2, order: 10 },
	trophies: { label: "Trophies", icon: 6, order: 11 },
	pets: { label: "Pets", icon: 4, order: 12 },
	room: { label: "Room & Building", icon: 8, order: 13 },
	other: { label: "Other", icon: 1, order: 99 },
};

// Classname prefix → category key (order matters: first match wins)
export const CLASSNAME_RULES: Array<{
	test: (cn: string, type: string) => boolean;
	cat: string;
}> = [
	{
		test: (cn) => /^CF_/i.test(cn) || /^exe_/i.test(cn) || cn === "credit",
		cat: "credits",
	},
	{ test: (cn) => /^rare_/i.test(cn), cat: "rares" },
	{ test: (cn) => /^wf_/i.test(cn), cat: "wired" },
	{ test: (cn) => /^nft_/i.test(cn), cat: "nft" },
	{
		test: (cn) =>
			/^(xmas|hween|easter|val_|valentine|hw_|newyear|summer|carnival)/i.test(
				cn,
			),
		cat: "seasonal",
	},
	{ test: (cn) => /^(trax|jukebox|sound|music)/i.test(cn), cat: "music" },
	{ test: (cn) => /^(clothing|clothes)/i.test(cn), cat: "clothing" },
	{ test: (cn) => /^bc_/i.test(cn), cat: "builders" },
	{ test: (cn) => /^(poster|wall_|window_|wallpaper)/i.test(cn), cat: "walls" },
	{ test: (_cn, type) => type === "wallitem" || type === "i", cat: "walls" },
	{ test: (cn) => /^(ads_|cstm_)/i.test(cn), cat: "promo" },
	{
		test: (cn) => /^(trophy|gold_|silver_|bronze_)/i.test(cn),
		cat: "trophies",
	},
	{
		test: (cn) =>
			/^(pet|dog|cat_|bird|horse|pig|monkey|frog|dragon|bear_|spider|bunny)/i.test(
				cn,
			),
		cat: "pets",
	},
	{
		test: (cn) =>
			/^(room_|floor_|tile_|carpet|rug|door_|gate_|stair)/i.test(cn),
		cat: "room",
	},
];

/** Determine the catalog category for a furniture item based on its classname and type. */
export function classifyFurni(classname: string, itemType: string): string {
	// Wall items are authoritative by type — a prefix rule (rare_, val_, xmas_,
	// …) must never pull a wall item out of the "walls" category.
	if (itemType === "wallitem" || itemType === "i") return "walls";
	for (const rule of CLASSNAME_RULES) {
		if (rule.test(classname, itemType)) return rule.cat;
	}
	return "other";
}

/**
 * Auto-detect catalog price from classname.
 * - CF_750_xxx → cost_credits = 750 (credit furni = the credit value it represents)
 * - exe_50, exe_100, exe_200 etc. → cost_credits based on exchange value
 * - rare_xxx → cost_credits = 25 (rares are expensive)
 * - wf_xxx → cost_credits = 5 (wired components)
 * - everything else → cost_credits = 3 (default)
 */
export function autoPriceFurni(classname: string): AutoPrice {
	// CF_<number>_xxx → credit furniture, price = the credit value
	const cfMatch = classname.match(/^CF_(\d+)/i);
	if (cfMatch) {
		return { credits: parseInt(cfMatch[1], 10), points: 0, pointsType: 0 };
	}

	// exe_<number> → exchange items (diamonds/duckets)
	const exeMatch = classname.match(/^exe_(\d+)/i);
	if (exeMatch) {
		return { credits: parseInt(exeMatch[1], 10), points: 0, pointsType: 0 };
	}

	// Rares
	if (/^rare_/i.test(classname)) {
		return { credits: 25, points: 0, pointsType: 0 };
	}

	// Wired
	if (/^wf_/i.test(classname)) {
		return { credits: 5, points: 0, pointsType: 0 };
	}

	// NFT items
	if (/^nft_/i.test(classname)) {
		return { credits: 10, points: 0, pointsType: 0 };
	}

	// Trophies
	if (/^(trophy|gold_|silver_|bronze_)/i.test(classname)) {
		return { credits: 10, points: 0, pointsType: 0 };
	}

	// Default
	return { credits: 3, points: 0, pointsType: 0 };
}

/** Combine auto-category + auto-price into a single preview for the Studio UI. */
export function previewAutoCatalog(
	classname: string,
	itemType: string,
): AutoCatalogPreview {
	const categoryKey = classifyFurni(classname, itemType);
	const categoryLabel =
		CATEGORY_PAGE[categoryKey]?.label ?? CATEGORY_PAGE.other.label;
	const price = autoPriceFurni(classname);
	return { ...price, categoryKey, categoryLabel };
}
