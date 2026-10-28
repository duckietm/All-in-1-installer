import type { AuthorizationActor } from "@/lib/admin/authorization-policy";

export interface RankAuthorityDb {
	user: {
		findUnique(args: {
			where: { id: number };
			select: { id: true; username: true; rank: true };
		}): Promise<{ id: number; username: string; rank: number } | null>;
	};
	highestRank(): Promise<number | null>;
}

export async function resolveAuthorizationState(
	userId: number,
	db: RankAuthorityDb,
): Promise<{ actor: AuthorizationActor; highestRank: number | null } | null> {
	const [user, highestRank] = await Promise.all([
		db.user.findUnique({
			where: { id: userId },
			select: { id: true, username: true, rank: true },
		}),
		db.highestRank(),
	]);
	if (!user) return null;
	return { actor: user, highestRank };
}
