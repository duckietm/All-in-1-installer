export interface FurniItem {
	attachmentId?: string;
	id: number;
	classname: string;
	type: string;
	name: string;
	description: string;
	revision: number;
	category: string;
	alreadyImported: boolean;
	nitroExists: boolean;
	/** Has an entry in FurnitureData.json */
	hasFurnidata?: boolean;
	/** Has an entry in catalog_items (SQL) */
	hasCatalogEntry?: boolean;
	/** Custom-source preview icon (retro hotel CDN). Absent for official Habbo items. */
	iconUrl?: string;
}

export interface Meta {
	currentPage: number;
	lastPage: number;
	total: number;
	perPage: number;
}

export interface FurniStats {
	totalInDb: number;
	inCatalog: number;
	notInCatalog: number;
	missingNitro: number;
}

export interface BatchItemStatus {
	classname: string;
	status:
		| "pending"
		| "started"
		| "downloading"
		| "converting"
		| "writing_db"
		| "done"
		| "failed";
	message?: string;
	warnings?: string[];
	itemId?: number;
}

/** Post-import verification results reported by the import API. */
export interface VerificationSummary {
	offerIdsFixed: number;
	furniDataFixedIds: number;
	furniDataMissing: number;
	furniDataConflicts: number;
	nitrosSynced: string[];
	iconsSynced: string[];
	ownershipFixed: string[];
}
