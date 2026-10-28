/**
 * Emulator-compatible ban expiry helpers.
 * `banExpire === 0` means permanent (Arcturus / Plus-style).
 */

export function unixNow(): number {
	return Math.floor(Date.now() / 1000);
}

export function isBanActive(
	banExpire: number,
	now: number = unixNow(),
): boolean {
	return banExpire === 0 || banExpire > now;
}

/** Filter for currently active bans (incl. permanent). */
export function activeBanWhere(now: number = unixNow()) {
	return {
		OR: [{ banExpire: 0 }, { banExpire: { gt: now } }],
	};
}
