/** A centered, bounded window including the current page, also at either end. */
export function tablePageNumbers(page: number, last: number): number[] {
	const count = Math.min(5, Math.max(1, last));
	const start = Math.max(1, Math.min(page - 2, last - count + 1));
	return Array.from({ length: count }, (_, index) => start + index);
}
