import { desc, eq, inArray } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, User, UsersCurrency } from "@/lib/db";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";

// Public REST API — leaderboard. Mirrors src/app/leaderboard/page.tsx.
// AtomCMS-faithful currency type ids (see UsersCurrency):
//   Credits = -1 (lives on users.credits), Duckets = 0, Diamonds = 5.

type LeaderboardType = "credits" | "diamonds" | "duckets";

const CURRENCY_TYPE: Record<Exclude<LeaderboardType, "credits">, number> = {
	diamonds: 5,
	duckets: 0,
};

type Row = {
	rank: number;
	userId: number;
	username: string;
	look: string;
	value: number;
};

/** Hidden-wallet users must not be listed, exactly like on the page. */
async function withoutHiddenWallets<T extends { userId: number }>(
	rows: T[],
): Promise<T[]> {
	const { loadProfilePrivacyMap } = await import(
		"@/lib/services/profile-privacy"
	);
	const privacy = await loadProfilePrivacyMap(rows.map((r) => r.userId));
	return rows.filter((r) => privacy.get(r.userId)?.wallet !== false);
}

async function loadCreditsRows(): Promise<Row[]> {
	const users = await db
		.select({
			userId: User.id,
			username: User.username,
			look: User.look,
			credits: User.credits,
		})
		.from(User)
		.orderBy(desc(User.credits))
		.limit(20);
	return (await withoutHiddenWallets(users)).map((u, i) => ({
		rank: i + 1,
		userId: u.userId,
		username: u.username,
		look: u.look,
		value: u.credits,
	}));
}

async function loadCurrencyRows(type: number): Promise<Row[]> {
	const top = await db
		.select({
			userId: UsersCurrency.userId,
			amount: UsersCurrency.amount,
		})
		.from(UsersCurrency)
		.where(eq(UsersCurrency.type, type))
		.orderBy(desc(UsersCurrency.amount))
		.limit(20);
	if (top.length === 0) return [];

	const users = await db
		.select({ id: User.id, username: User.username, look: User.look })
		.from(User)
		.where(
			inArray(
				User.id,
				top.map((t) => t.userId),
			),
		);
	const allowed = await withoutHiddenWallets(top);
	const allowedIds = new Set(allowed.map((t) => t.userId));
	const byId = new Map(
		users.filter((u) => allowedIds.has(u.id)).map((u) => [u.id, u]),
	);

	return allowed
		.map((t) => {
			const u = byId.get(t.userId);
			if (!u) return null;
			return {
				userId: u.id,
				username: u.username,
				look: u.look,
				value: t.amount,
			};
		})
		.filter((r) => r !== null)
		.map((r, i) => ({ rank: i + 1, ...r }));
}

export async function GET(req: Request) {
	try {
		const sp = new URL(req.url).searchParams;
		const requested = sp.get("type");
		const type: LeaderboardType =
			requested === "diamonds" || requested === "duckets"
				? requested
				: "credits";

		const rows = await redisCache(
			apiCacheKey(`leaderboard:${type}`),
			60,
			async () =>
				type === "credits"
					? await loadCreditsRows()
					: // type validated to "diamonds"|"duckets"
						await loadCurrencyRows(CURRENCY_TYPE[type]),
			// Rankings are re-sorted on every read; serving the previous order for a
			// minute keeps a busy leaderboard off the database.
			{ staleMs: 60 },
		);

		return apiJson(
			{ type, data: rows },
			{ headers: { "cache-control": publicCacheControl(60) }, status: 200 },
		);
	} catch {
		return apiJson({ type: "credits", data: [] }, { status: 200 });
	}
}
