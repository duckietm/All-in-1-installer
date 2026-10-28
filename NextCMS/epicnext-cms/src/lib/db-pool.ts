/**
 * Cap pool size during `next build` so N workers × pool don't exhaust MySQL.
 * Kept free of driver/env imports so unit tests can exercise it in isolation.
 */
export function resolveConnectionLimit(
	poolSize: number,
	phase = process.env.NEXT_PHASE,
): number {
	if (
		phase === "phase-production-build" ||
		phase === "phase-production-compile"
	) {
		return Math.min(poolSize, 5);
	}
	return poolSize;
}
