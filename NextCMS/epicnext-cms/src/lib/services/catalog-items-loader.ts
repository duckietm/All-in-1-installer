import { asc, sql } from "drizzle-orm";
import { numericValue } from "@/features/catalog/domain/offer-input";
import { CatalogPages, CatalogPagesBc, db, queryRows } from "@/lib/db";
import { readFurniData } from "@/lib/services/furni-data";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";

interface FurnitypeEntry {
	id: number;
	description?: string;
	classname?: string;
	revision?: number;
}

interface FurnitureData {
	roomitemtypes?: { furnitype?: FurnitypeEntry[] };
	wallitemtypes?: { furnitype?: FurnitypeEntry[] };
}

/**
 * FurnitureData.json via the shared reader.
 *
 * This module used to keep its own 30s TTL copy of the file next to the
 * mtime-validated cache in `furni-data.ts`. Two caches over one file meant an
 * import cleared only the first one, so this loader kept serving the
 * pre-import furnidata (empty descriptions and revisions) until the TTL ran
 * out. `readFurniData` revalidates on `mtimeMs`+`size` and is reset by every
 * write, so there is now exactly one cache and it cannot go stale on its own.
 */
async function getFurnitureData(): Promise<FurnitureData | null> {
	try {
		return (await readFurniData()) as FurnitureData;
	} catch {
		return null;
	}
}

interface RawItem {
	id: number;
	itemIds: string;
	pageId: number;
	offerId: number;
	songId: number;
	orderNumber: number;
	catalogName: string;
	costCredits: number;
	costPoints: number;
	pointsType: number;
	amount: number;
	limitedSells: number;
	limitedStack: number;
	extradata: string;
	haveOffer: string;
	clubOnly: string;
}

interface BaseItem {
	id: number;
	spriteId: number;
	publicName: string;
	itemName: string;
	type: string;
	width: number;
	length: number;
	stackHeight: number;
	allowStack: number;
	allowSit: number;
	allowLay: number;
	allowWalk: number;
	allowGift: number;
	allowTrade: number;
	allowRecycle: number;
	allowMarketplaceSell: number;
	allowInventoryStack: number;
	interactionType: string;
	interactionModesCount: number;
	vendingIds: string;
	customparams: string;
	effectIdMale: number;
	effectIdFemale: number;
	clothingOnWalk: string;
}

export interface CatalogItemEnriched {
	id: number;
	catalogName: string;
	itemIds: string;
	costCredits: number;
	costPoints: number;
	pointsType: number;
	amount: number;
	limitedSells: number;
	limitedStack: number;
	orderNumber: number;
	offerId: number;
	songId: number;
	haveOffer: string;
	clubOnly: string;
	extradata: string;
	baseName: string;
	baseItemName: string;
	spriteId: number;
	baseItem: BaseItem | null;
}

export interface CatalogItemsData {
	items: CatalogItemEnriched[];
	baseItems: {
		id: number;
		publicName: string;
		itemName: string;
		spriteId: number;
		type: string;
	}[];
	catalogNameMap: Record<number, string>;
	furniDataIdList: number[];
	furniDescriptionMap: Record<number, string>;
	furniRevisionMap: Record<number, { classname: string; revision: number }>;
	interactionTypes: string[];
	allPages: { id: number; caption: string }[];
	/** CMS `habbo_gamedata_hotel` — locale used for Suggest names */
	gamedataHotel: string;
	/** Which catalog these offers came from; BC rows carry no prices. */
	catalog: "normal" | "bc";
}

export async function loadCatalogItemsData(
	pageId: number,
	catalog: "normal" | "bc" = "normal",
): Promise<CatalogItemsData> {
	// Load items via raw query to work around pageId Int vs VARCHAR mismatch.
	// Bind the id as a *string* constant: MySQL/MariaDB coerce a constant to the
	// column's type once, so `page_id = ?` stays sargable whether the live column
	// is INT or VARCHAR. Casting the column (CAST(page_id AS CHAR)) would wrap it
	// in a function and force a full table scan.
	const pageIdStr = String(pageId);
	const offers = catalog === "bc" ? "catalog_items_bc" : "catalog_items";
	const rawItems = await queryRows<Record<string, unknown>>(sql`
    SELECT * FROM ${sql.raw(offers)}
    WHERE page_id = ${pageIdStr}
    ORDER BY order_number ASC, id ASC
  `);
	// The BC table carries only a reference to the furniture: there are no price,
	// limit or membership columns to read. Every other field is filled from the
	// column default so the table renders, and stays read-only for those fields
	// rather than pretending a price exists.
	const items: RawItem[] = rawItems.map((r) => ({
		id: Number(r.id),
		itemIds: String(r.item_ids ?? ""),
		pageId: numericValue(r.page_id, 0),
		offerId: numericValue(r.offer_id, -1),
		songId: numericValue(r.song_id, 0),
		orderNumber: numericValue(r.order_number, 99),
		catalogName: String(r.catalog_name ?? ""),
		costCredits: numericValue(r.cost_credits, 0),
		costPoints: numericValue(r.cost_points, 0),
		pointsType: numericValue(r.points_type, 0),
		amount: numericValue(r.amount, 1),
		limitedSells: numericValue(r.limited_sells, 0),
		limitedStack: numericValue(r.limited_stack, 0),
		extradata: String(r.extradata ?? ""),
		haveOffer: String(r.have_offer ?? "1"),
		clubOnly: String(r.club_only ?? "0"),
	}));

	const pagesTable = catalog === "bc" ? CatalogPagesBc : CatalogPages;
	const [allPages, interactionTypesRaw, gamedataHotel] = await Promise.all([
		db
			.select({ id: pagesTable.id, caption: pagesTable.caption })
			.from(pagesTable)
			.orderBy(asc(pagesTable.caption)),
		queryRows<{ interaction_type: string }>(sql`
      SELECT DISTINCT interaction_type FROM items_base ORDER BY interaction_type ASC
    `),
		getHabboGamedataHotel(),
	]);

	const interactionTypes = interactionTypesRaw.map((r) =>
		String(r.interaction_type),
	);

	// Resolve item names from items_base for enrichment + translate
	const itemIdStrings = items.map((i) => i.itemIds).filter(Boolean);
	const baseItemIds = [
		...new Set(
			itemIdStrings.flatMap((s) =>
				s
					.split(";")
					.map(Number)
					.filter((n) => n > 0),
			),
		),
	];

	// Raw query to work around ENUM('0','1') columns returning numeric values.
	// baseItemIds is built from numeric splits + filter(n > 0); joined via sql.join.
	const baseItemRows =
		baseItemIds.length > 0
			? await queryRows<Record<string, unknown>>(sql`
            SELECT id, sprite_id, public_name, item_name, type, width, length,
                   stack_height, allow_stack, allow_sit, allow_lay, allow_walk,
                   allow_gift, allow_trade, allow_recycle, allow_marketplace_sell,
                   allow_inventory_stack, interaction_type, interaction_modes_count,
                   vending_ids, customparams, effect_id_male, effect_id_female,
                   clothing_on_walk
            FROM items_base WHERE id IN (${sql.join(baseItemIds, sql`, `)})
          `)
			: [];

	const baseItems: BaseItem[] = baseItemRows.map((r) => ({
		id: Number(r.id),
		spriteId: Number(r.sprite_id),
		publicName: String(r.public_name ?? ""),
		itemName: String(r.item_name ?? ""),
		type: String(r.type ?? "s"),
		width: numericValue(r.width, 1),
		length: numericValue(r.length, 1),
		stackHeight: numericValue(r.stack_height, 0),
		allowStack: Number(r.allow_stack ?? 0),
		allowSit: Number(r.allow_sit ?? 0),
		allowLay: Number(r.allow_lay ?? 0),
		allowWalk: Number(r.allow_walk ?? 0),
		allowGift: Number(r.allow_gift ?? 1),
		allowTrade: Number(r.allow_trade ?? 1),
		allowRecycle: Number(r.allow_recycle ?? 0),
		allowMarketplaceSell: Number(r.allow_marketplace_sell ?? 0),
		allowInventoryStack: Number(r.allow_inventory_stack ?? 1),
		interactionType: String(r.interaction_type ?? "default"),
		interactionModesCount: numericValue(r.interaction_modes_count, 2),
		vendingIds: String(r.vending_ids ?? "0"),
		customparams: String(r.customparams ?? ""),
		effectIdMale: numericValue(r.effect_id_male, 0),
		effectIdFemale: numericValue(r.effect_id_female, 0),
		clothingOnWalk: String(r.clothing_on_walk ?? ""),
	}));

	const baseItemMap = Object.fromEntries(baseItems.map((b) => [b.id, b]));

	// Build mapping: baseItemId -> catalogName
	const catalogNameMap: Record<number, string> = {};
	for (const item of items) {
		const firstBaseId = item.itemIds
			.split(";")
			.map(Number)
			.find((n) => n > 0);
		if (firstBaseId && !catalogNameMap[firstBaseId]) {
			catalogNameMap[firstBaseId] = item.catalogName;
		}
	}

	const catalogItems: CatalogItemEnriched[] = items.map((item) => {
		const firstBaseId = item.itemIds
			.split(";")
			.map(Number)
			.find((n) => n > 0);
		const base = firstBaseId ? baseItemMap[firstBaseId] : undefined;
		return {
			id: item.id,
			catalogName: item.catalogName,
			itemIds: item.itemIds,
			costCredits: item.costCredits,
			costPoints: item.costPoints,
			pointsType: item.pointsType,
			amount: item.amount,
			limitedSells: item.limitedSells,
			limitedStack: item.limitedStack,
			orderNumber: item.orderNumber,
			offerId: item.offerId,
			songId: item.songId,
			haveOffer: item.haveOffer,
			clubOnly: item.clubOnly,
			extradata: item.extradata,
			baseName: base?.publicName || base?.itemName || "",
			baseItemName: base?.itemName || "",
			spriteId: base?.spriteId ?? 0,
			baseItem: base ? { ...base } : null,
		};
	});

	// Build spriteId -> items_base.id mapping for FurnitureData.json lookup
	const spriteToBaseId = new Map<number, number>();
	for (const b of baseItems) {
		spriteToBaseId.set(b.spriteId, b.id);
	}

	// Read FurnitureData.json through the shared mtime-validated reader.
	const foundBaseIds = new Set<number>();
	const furniDescriptionMap: Record<number, string> = {};
	const furniRevisionMap: Record<
		number,
		{ classname: string; revision: number }
	> = {};
	const furniData = await getFurnitureData();
	if (furniData) {
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			if (furniData[section]?.furnitype) {
				for (const item of furniData[section].furnitype) {
					const baseId = spriteToBaseId.get(item.id);
					if (baseId !== undefined) {
						foundBaseIds.add(baseId);
						furniDescriptionMap[baseId] = item.description ?? "";
						furniRevisionMap[baseId] = {
							classname: item.classname ?? "",
							revision: item.revision ?? 0,
						};
					}
				}
			}
		}
	}

	return {
		items: catalogItems,
		baseItems: baseItems.map((b) => ({
			id: b.id,
			publicName: b.publicName,
			itemName: b.itemName,
			spriteId: b.spriteId,
			type: b.type,
		})),
		catalogNameMap,
		furniDataIdList: [...foundBaseIds],
		furniDescriptionMap,
		furniRevisionMap,
		interactionTypes,
		allPages,
		gamedataHotel,
		catalog,
	};
}
