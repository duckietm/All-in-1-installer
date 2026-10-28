export interface HabboFurniItem {
	id: number;
	classname: string;
	type: string;
	name: string;
	description: string;
	revision: number;
	category: string;
}

export interface FurniListResult {
	items: HabboFurniItem[];
	meta: {
		currentPage: number;
		lastPage: number;
		total: number;
		perPage: number;
	};
}

export interface FurniMetadata {
	visualizationType: string;
	logicType: string;
	canstandon: boolean;
	cansiton: boolean;
	canlayon: boolean;
	/** True when the SWF logic XML declared <action> nodes (flags authoritative). */
	hasActions?: boolean;
	specialtype: number;
	defaultdir: number;
	partcolors: { color: string[] };
}

export interface ConversionResult {
	bundle: Buffer;
	classname: string;
	dimensions: { x: number; y: number; z: number };
	directions: number[];
	spriteCount: number;
	warnings: string[];
	metadata: FurniMetadata;
}

export interface BatchConversionItem {
	swfBuffer: Buffer;
	classname: string;
}

export interface BatchConversionResult {
	classname: string;
	success: boolean;
	bundle?: Buffer;
	dimensions?: { x: number; y: number; z: number };
	directions?: number[];
	spriteCount?: number;
	warnings: string[];
	error?: string;
}

export interface OfficialHabboFurniEntry {
	id: number;
	classname: string;
	revision: number;
	category: string;
	defaultdir: number;
	xdim: number;
	ydim: number;
	partcolors: { color: string[] };
	name: string;
	description: string;
	specialtype: number;
	canstandon: boolean;
	cansiton: boolean;
	canlayon: boolean;
	furniline: string;
	environment: string;
	rare: boolean;
	tradeable?: boolean;
	bc?: boolean;
	customparams?: string | null;
	itemType: "s" | "i";
}

export interface HabboAssetBadge {
	id: number;
	code: string;
	name: string;
	description: string;
	hotel: string;
	url_habbo: string;
	url_habboassets: string;
}

export interface ImportSingleResult {
	ok: boolean;
	itemId?: number;
	catalogItemId?: number | null;
	catalogUpdated?: boolean;
	dimensions?: { x: number; y: number; z: number };
	spriteCount?: number;
	warnings: string[];
	error?: string;
	furniDataEntry?: { entry: Record<string, unknown>; itemType: string };
}
