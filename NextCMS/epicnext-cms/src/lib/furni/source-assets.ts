export interface SourceAssetItem {
	id: number;
	classname: string;
	name: string;
	description: string;
	type: string;
	revision: number;
	category: string;
}
export type AssetAvailability = "available" | "missing" | "unknown";
export interface SourceAssetAttempt {
	url: string;
	file: string;
	state: AssetAvailability;
	reason: "available" | "http" | "network" | "timeout" | "invalidResponse";
	status?: number;
}
export interface SourceAssetCheck {
	attempts?: SourceAssetAttempt[];
	classname: string;
	state: AssetAvailability;
	revision: number;
	alternatives: SourceAssetItem[];
}
