export interface BaseItemData {
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

export interface CatalogItemData {
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
	baseItem: BaseItemData | null;
}

export interface InlineEdit {
	costCredits: number;
	costPoints: number;
	pointsType: number;
	amount: number;
}

export const POINTS_TYPES: Record<number, { label: string; color: string }> = {
	0: { label: "Duckets", color: "text-[var(--admin-info)]" },
	5: { label: "Diamonds", color: "text-[var(--admin-accent-text)]" },
	101: { label: "Snowflakes", color: "text-[var(--admin-info)]" },
	103: { label: "Hearts", color: "text-[var(--admin-error)]" },
	104: { label: "Stars", color: "text-[var(--admin-warning)]" },
	105: { label: "Shells", color: "text-[var(--admin-warning)]" },
};

export const DEFAULT_NEW_ITEM = {
	catalogName: "",
	itemIds: "0",
	costCredits: 0,
	costPoints: 0,
	pointsType: 0,
	amount: 1,
	limitedSells: 0,
	limitedStack: 0,
	orderNumber: 1,
	offerId: -1,
	songId: 0,
	haveOffer: "1",
	clubOnly: "0",
	extradata: "",
};

export function getPointsLabel(type: number) {
	return (
		POINTS_TYPES[type] || { label: `Type ${type}`, color: "theme-text-muted" }
	);
}
