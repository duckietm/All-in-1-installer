export interface AuthorizationActor {
	id: number;
	username: string;
	rank: number;
}
export type AuthorizationDenialReason =
	| "invalid_rank"
	| "permission_denied"
	| "no_ranks";
export type AuthorizationDecision =
	| { allowed: true; superAdmin: boolean }
	| { allowed: false; reason: AuthorizationDenialReason };

export function isDynamicSuperAdmin(
	rank: number,
	highestRank: number | null,
): boolean {
	return (
		Number.isInteger(rank) &&
		rank > 0 &&
		highestRank !== null &&
		rank === highestRank
	);
}

export function decideAuthorization(input: {
	actor: AuthorizationActor;
	highestRank: number | null;
	permission?: string;
	hasPermission: boolean;
}): AuthorizationDecision {
	if (!Number.isInteger(input.actor.rank) || input.actor.rank <= 0)
		return { allowed: false, reason: "invalid_rank" };
	if (input.highestRank === null) return { allowed: false, reason: "no_ranks" };
	if (isDynamicSuperAdmin(input.actor.rank, input.highestRank))
		return { allowed: true, superAdmin: true };
	if (!input.permission || input.hasPermission)
		return { allowed: true, superAdmin: false };
	return { allowed: false, reason: "permission_denied" };
}
