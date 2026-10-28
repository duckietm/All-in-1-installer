export const USER_TOKENABLE_TYPE = "App\\Models\\User";

export function personalTokenScope(userId: number) {
	return {
		tokenableId: BigInt(userId),
		tokenableType: USER_TOKENABLE_TYPE,
	} as const;
}
