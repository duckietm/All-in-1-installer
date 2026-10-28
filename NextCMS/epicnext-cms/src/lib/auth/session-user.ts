export function sessionUserId(value: unknown): number | null {
	const id =
		typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function databaseUserId(value: bigint): number | null {
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}
