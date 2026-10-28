/** All known catalog page layouts for Habbo/Arcturus. */
export const CATALOG_LAYOUTS = [
	"default_3x3",
	"frontpage",
	"spaces_new",
	"recycler",
	"trophies",
	"pets",
	"pets2",
	"pets3",
	"soundmachine",
	"guilds",
	"info_loyalty",
	"info_duckets",
	"loyalty_vip_buy",
	"single_bundle",
	"club_buy",
	"marketplace",
	"badge_display",
	"room_bundle",
	"sold_ltd_items",
] as const;

export type CatalogLayout = (typeof CATALOG_LAYOUTS)[number];

/** Type guard to check if a string is a valid CatalogLayout. */
export function isValidCatalogLayout(layout: string): layout is CatalogLayout {
	return (CATALOG_LAYOUTS as readonly string[]).includes(layout);
}

/** Short human-readable description for each layout. Shown in the layout selector. */
export const LAYOUT_DESCRIPTIONS: Record<CatalogLayout, string> = {
	default_3x3: "Standard 3-column grid of items",
	frontpage: "Featured landing page with large teasers",
	spaces_new: "Wide 4-column grid used for themed spaces",
	recycler: "Ecotron recycler exchange page",
	trophies: "Trophy crafting form",
	pets: "Legacy pet purchase page",
	pets2: "Pet purchase page (v2)",
	pets3: "Pet purchase page (v3)",
	soundmachine: "Soundmachine track picker",
	guilds: "Guild/group creation page",
	info_loyalty: "Informational loyalty page (no items)",
	info_duckets: "Informational duckets page (no items)",
	loyalty_vip_buy: "HC/VIP loyalty purchase",
	single_bundle: "Single prominent bundle tile",
	club_buy: "HC subscription purchase page",
	marketplace: "Marketplace entry page",
	badge_display: "Badge showcase page",
	room_bundle: "Room bundle purchase page",
	sold_ltd_items: "Sold limited editions archive",
};
