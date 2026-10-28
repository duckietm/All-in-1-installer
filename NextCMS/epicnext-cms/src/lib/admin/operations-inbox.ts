export type OperationsSource =
	| "errors"
	| "imports"
	| "tickets"
	| "publications";
export interface OperationsItem {
	id: string;
	source: OperationsSource;
	href: string;
	count: number;
	severity: number;
}
export interface OperationsLoader {
	source: OperationsSource;
	allowed: boolean;
	load: () => Promise<OperationsItem[]>;
}
/** Authorization precedes loading; a failed source is never reported as empty. */
export async function collectOperations(loaders: OperationsLoader[]) {
	const available = loaders.filter((loader) => loader.allowed);
	const results = await Promise.allSettled(
		available.map((loader) => loader.load()),
	);
	const unique = new Map<string, OperationsItem>();
	const unavailable: OperationsSource[] = [];
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			unavailable.push(available[index].source);
			continue;
		}
		for (const item of result.value) {
			const key = `${item.source}:${item.id}`;
			if (item.count > 0 && !unique.has(key)) unique.set(key, item);
		}
	}
	return {
		items: [...unique.values()]
			.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))
			.slice(0, 12),
		unavailable,
	};
}
