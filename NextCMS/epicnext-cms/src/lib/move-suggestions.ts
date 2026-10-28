/**
 * Learns where items get moved and suggests target pages for future moves.
 * Stores patterns in localStorage:
 *   - By interaction type (e.g. "clothing" → page #42)
 *   - By item name prefix (e.g. "rare_" → page #15)
 *   - Recent moves (last 10)
 *
 * All suggestions are non-forced — just ranked higher in the combobox.
 */

const STORAGE_KEY = "catalog_move_suggestions";

interface MoveRecord {
	targetPageId: number;
	count: number;
}

interface SuggestionStore {
	/** interaction type → target pages with count */
	byType: Record<string, MoveRecord[]>;
	/** item name prefix (first segment before _) → target pages with count */
	byPrefix: Record<string, MoveRecord[]>;
	/** last N recent targets */
	recent: number[];
}

function load(): SuggestionStore {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { byType: {}, byPrefix: {}, recent: [] };
}

function save(store: SuggestionStore) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {}
}

function extractPrefix(itemName: string): string {
	if (!itemName) return "";
	const idx = itemName.indexOf("_");
	return idx > 0
		? itemName.substring(0, idx).toLowerCase()
		: itemName.toLowerCase();
}

function incrementRecord(
	records: MoveRecord[],
	targetPageId: number,
): MoveRecord[] {
	const existing = records.find((r) => r.targetPageId === targetPageId);
	if (existing) {
		return records
			.map((r) =>
				r.targetPageId === targetPageId ? { ...r, count: r.count + 1 } : r,
			)
			.sort((a, b) => b.count - a.count);
	}
	return [...records, { targetPageId, count: 1 }]
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);
}

/**
 * Record a move for learning. Call this after successfully moving an item.
 */
export function recordMove(opts: {
	interactionType?: string;
	itemName?: string;
	targetPageId: number;
}) {
	const store = load();
	const { interactionType, itemName, targetPageId } = opts;

	if (interactionType) {
		const key = interactionType.toLowerCase();
		store.byType[key] = incrementRecord(store.byType[key] || [], targetPageId);
	}

	const prefix = extractPrefix(itemName ?? "");
	if (prefix && prefix.length > 1) {
		store.byPrefix[prefix] = incrementRecord(
			store.byPrefix[prefix] || [],
			targetPageId,
		);
	}

	// Recent (deduplicate, keep last 10)
	store.recent = [
		targetPageId,
		...store.recent.filter((id) => id !== targetPageId),
	].slice(0, 10);

	save(store);
}

/**
 * Get suggested page IDs for moving an item, ranked by relevance.
 * Returns unique page IDs ordered by best match.
 */
export function getSuggestions(opts: {
	interactionType?: string;
	itemName?: string;
}): number[] {
	const store = load();
	const { interactionType, itemName } = opts;
	const scores = new Map<number, number>();

	// By interaction type (highest weight)
	if (interactionType) {
		const records = store.byType[interactionType.toLowerCase()] || [];
		for (const r of records) {
			scores.set(
				r.targetPageId,
				(scores.get(r.targetPageId) ?? 0) + r.count * 3,
			);
		}
	}

	// By name prefix
	const prefix = extractPrefix(itemName ?? "");
	if (prefix && prefix.length > 1) {
		const records = store.byPrefix[prefix] || [];
		for (const r of records) {
			scores.set(
				r.targetPageId,
				(scores.get(r.targetPageId) ?? 0) + r.count * 2,
			);
		}
	}

	// Recent (lowest weight)
	for (let i = 0; i < store.recent.length; i++) {
		const id = store.recent[i];
		scores.set(id, (scores.get(id) ?? 0) + (10 - i));
	}

	return Array.from(scores.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => id);
}
