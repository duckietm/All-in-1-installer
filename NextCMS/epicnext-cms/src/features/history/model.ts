export type HistorySnapshot = Record<string, string | number | null>;
export function sameSnapshot(a: HistorySnapshot, b: HistorySnapshot): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
	);
}
export function historyChanges(
	current: HistorySnapshot,
	restore: HistorySnapshot,
) {
	return Object.keys(restore)
		.filter((key) => current[key] !== restore[key])
		.map((key) => ({ key, current: current[key], restore: restore[key] }));
}
