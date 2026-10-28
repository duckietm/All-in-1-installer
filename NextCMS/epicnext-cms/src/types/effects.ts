export interface EffectMapEntry {
	id: string;
	lib: string;
	type: string; // 'fx' | 'dance'
	revision: number;
}

export interface EffectListItem extends EffectMapEntry {
	present: boolean;
	nitroExists: boolean;
}

export interface ImportEffectResult {
	ok: boolean;
	lib: string;
	warnings: string[];
	error?: string;
}
