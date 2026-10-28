import { eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { apiJson } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { db, queryRows, User, UsersSettings } from "@/lib/db";
import { logger } from "@/lib/logger";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

type BadgeRarityKey =
	| "common"
	| "rare"
	| "epic"
	| "legendary"
	| "mythical"
	| "unique";

interface BadgeLeaderboardEntry {
	userId: number;
	username: string;
	figure: string;
	score: number;
	rank: number;
}

interface BadgeLeaderboardBoard {
	entries: BadgeLeaderboardEntry[];
	totalPlayers: number;
	viewerEntry?: Partial<BadgeLeaderboardEntry>;
}

/** The shared, viewer-independent part of a leaderboard (cacheable). */
type BoardCore = {
	entries: BadgeLeaderboardEntry[];
	totalPlayers: number;
};

interface BadgeLeaderboardStat {
	badgeCode: string;
	ownerCount: number;
	rarity: BadgeRarityKey;
}

const THRESHOLDS = {
	commonMinOwners: 500,
	rareMinOwners: 100,
	epicMinOwners: 20,
	legendaryMinOwners: 5,
	mythicalMinOwners: 2,
	uniqueOwners: 1,
};

function assignRarity(ownerCount: number): BadgeRarityKey {
	if (ownerCount >= THRESHOLDS.commonMinOwners) return "common";
	if (ownerCount >= THRESHOLDS.rareMinOwners) return "rare";
	if (ownerCount >= THRESHOLDS.epicMinOwners) return "epic";
	if (ownerCount >= THRESHOLDS.legendaryMinOwners) return "legendary";
	if (ownerCount >= THRESHOLDS.mythicalMinOwners) return "mythical";
	return "unique";
}

function rankEntries(
	entries: BadgeLeaderboardEntry[],
): BadgeLeaderboardEntry[] {
	return entries
		.sort((a, b) => b.score - a.score)
		.map((e, i) => ({ ...e, rank: i + 1 }));
}

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	return queryRows<T>(query);
}

async function loadTotalBadgesBoard(): Promise<BoardCore> {
	const rows = await rawRows<{
		userId: bigint;
		username: string;
		look: string;
		cnt: bigint;
	}>(sql`
      SELECT ub.user_id AS userId, u.username, u.look, COUNT(*) AS cnt
      FROM users_badges ub
      JOIN users u ON u.id = ub.user_id
      GROUP BY ub.user_id
      ORDER BY cnt DESC
      LIMIT 20
    `);

	const entries = rankEntries(
		rows.map((r) => ({
			userId: Number(r.userId),
			username: r.username,
			figure: r.look,
			score: Number(r.cnt),
			rank: 0,
		})),
	);

	const totalPlayers =
		entries.length > 0
			? Number(
					(
						await rawRows<{ cnt: bigint }>(
							sql`SELECT COUNT(DISTINCT user_id) AS cnt FROM users_badges`,
						)
					)[0]?.cnt ?? 0,
				)
			: 0;

	return { entries, totalPlayers };
}

async function loadAchievementBoard(): Promise<BoardCore> {
	const rows = await rawRows<{
		userId: bigint;
		username: string;
		look: string;
		score: number;
	}>(sql`
      SELECT us.user_id AS userId, u.username, u.look, us.achievement_score AS score
      FROM users_settings us
      JOIN users u ON u.id = us.user_id
      ORDER BY us.achievement_score DESC
      LIMIT 20
    `);

	const entries = rankEntries(
		rows.map((r) => ({
			userId: Number(r.userId),
			username: r.username,
			figure: r.look,
			score: r.score,
			rank: 0,
		})),
	);

	const totalPlayers =
		entries.length > 0
			? Number(
					(
						await rawRows<{ cnt: bigint }>(
							sql`SELECT COUNT(*) AS cnt FROM users_settings WHERE achievement_score > 0`,
						)
					)[0]?.cnt ?? 0,
				)
			: 0;

	return { entries, totalPlayers };
}

async function loadRarityBoard(badgeCodes: string[]): Promise<BoardCore> {
	if (badgeCodes.length === 0) return { entries: [], totalPlayers: 0 };

	const codes = sql.join(
		badgeCodes.map((c) => sql`${c}`),
		sql`, `,
	);

	const rows = await rawRows<{
		userId: bigint;
		username: string;
		look: string;
		cnt: bigint;
	}>(sql`
      SELECT ub.user_id AS userId, u.username, u.look, COUNT(*) AS cnt
      FROM users_badges ub
      JOIN users u ON u.id = ub.user_id
      WHERE ub.badge_code IN (${codes})
      GROUP BY ub.user_id
      ORDER BY cnt DESC
      LIMIT 20
    `);

	const entries = rankEntries(
		rows.map((r) => ({
			userId: Number(r.userId),
			username: r.username,
			figure: r.look,
			score: Number(r.cnt),
			rank: 0,
		})),
	);

	const totalPlayers =
		rows.length > 0
			? Number(
					(
						await rawRows<{ cnt: bigint }>(sql`
                SELECT COUNT(DISTINCT user_id) AS cnt FROM users_badges WHERE badge_code IN (${codes})
              `)
					)[0]?.cnt ?? 0,
				)
			: 0;

	return { entries, totalPlayers };
}

async function loadTotalBadgesViewer(
	userId: number,
): Promise<Partial<BadgeLeaderboardEntry> | undefined> {
	const viewerRow = await rawRows<{ cnt: bigint }>(
		sql`SELECT COUNT(*) AS cnt FROM users_badges WHERE user_id = ${userId}`,
	);
	const viewerScore = Number(viewerRow[0]?.cnt ?? 0);
	if (viewerScore <= 0) return undefined;

	const rankRow = await rawRows<{ cnt: bigint }>(sql`
      SELECT COUNT(*) + 1 AS cnt
      FROM (SELECT user_id, COUNT(*) AS total FROM users_badges GROUP BY user_id) t
      WHERE t.total > ${viewerScore}
    `);
	const rank = Number(rankRow[0]?.cnt ?? 1);

	const [viewerUser] = await db
		.select({ username: User.username, look: User.look })
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	if (!viewerUser) return undefined;

	return {
		userId,
		username: viewerUser.username,
		figure: viewerUser.look,
		score: viewerScore,
		rank,
	};
}

async function loadAchievementViewer(
	userId: number,
): Promise<Partial<BadgeLeaderboardEntry> | undefined> {
	const [viewerUser] = await db
		.select({ username: User.username, look: User.look })
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	if (!viewerUser) return undefined;

	const [viewerSettings] = await db
		.select({ achievementScore: UsersSettings.achievementScore })
		.from(UsersSettings)
		.where(eq(UsersSettings.userId, userId))
		.limit(1);
	if (!viewerSettings || viewerSettings.achievementScore <= 0) return undefined;

	const rankRow = await rawRows<{ cnt: bigint }>(sql`
      SELECT COUNT(*) + 1 AS cnt FROM users_settings WHERE achievement_score > ${viewerSettings.achievementScore}
    `);
	const rank = Number(rankRow[0]?.cnt ?? 1);

	return {
		userId,
		username: viewerUser.username,
		figure: viewerUser.look,
		score: viewerSettings.achievementScore,
		rank,
	};
}

async function loadRarityViewer(
	userId: number,
	badgeCodes: string[],
): Promise<Partial<BadgeLeaderboardEntry> | undefined> {
	if (badgeCodes.length === 0) return undefined;

	const codes = sql.join(
		badgeCodes.map((c) => sql`${c}`),
		sql`, `,
	);

	const viewerRow = await rawRows<{ cnt: bigint }>(sql`
      SELECT COUNT(*) AS cnt FROM users_badges
      WHERE user_id = ${userId} AND badge_code IN (${codes})
    `);
	const viewerScore = Number(viewerRow[0]?.cnt ?? 0);
	if (viewerScore <= 0) return undefined;

	const [viewerUser] = await db
		.select({ username: User.username, look: User.look })
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	if (!viewerUser) return undefined;

	const rankRow = await rawRows<{ cnt: bigint }>(sql`
      SELECT COUNT(*) + 1 AS cnt
      FROM (SELECT user_id, COUNT(*) AS total FROM users_badges WHERE badge_code IN (${codes}) GROUP BY user_id) t
      WHERE t.total > ${viewerScore}
    `);
	const rank = Number(rankRow[0]?.cnt ?? 1);

	return {
		userId,
		username: viewerUser.username,
		figure: viewerUser.look,
		score: viewerScore,
		rank,
	};
}

export async function GET(req: Request) {
	await connection();
	try {
		let userId: number | null = await bearerUserId(req, ["badges:read"]);
		if (!req.headers.has("authorization")) {
			const session = await auth();
			userId = session?.user?.id ? Number(session.user.id) : null;
		}

		const rarityKeys: BadgeRarityKey[] = [
			"common",
			"rare",
			"epic",
			"legendary",
			"mythical",
			"unique",
		];

		// The heavy global aggregation (badge rarity stats + the 8 leaderboards)
		// is user-independent, so it is cached and recomputed once per TTL instead
		// of on every request. The viewer's own rank is derived per request.
		const global = await redisCache(
			apiCacheKey("badges:leaderboard:global"),
			120,
			async () => {
				const badgeStatsRaw = await rawRows<{
					badgeCode: string;
					ownerCount: bigint;
				}>(sql`
          SELECT badge_code AS badgeCode, COUNT(DISTINCT user_id) AS ownerCount
          FROM users_badges
          GROUP BY badge_code
        `);

				const badgeStats: BadgeLeaderboardStat[] = badgeStatsRaw.map((r) => ({
					badgeCode: r.badgeCode,
					ownerCount: Number(r.ownerCount),
					rarity: assignRarity(Number(r.ownerCount)),
				}));

				const badgesByRarity = new Map<BadgeRarityKey, string[]>();
				for (const stat of badgeStats) {
					const list = badgesByRarity.get(stat.rarity) ?? [];
					list.push(stat.badgeCode);
					badgesByRarity.set(stat.rarity, list);
				}

				const [totalBadges, achievementLevel, ...rarityBoards] =
					await Promise.all([
						loadTotalBadgesBoard(),
						loadAchievementBoard(),
						...rarityKeys.map((rk) =>
							loadRarityBoard(badgesByRarity.get(rk) ?? []),
						),
					]);

				const rarity = Object.fromEntries(
					// rk from rarityKeys const, i is array index
					rarityKeys.map((rk, i) => [rk, rarityBoards[i]]),
				) as Record<BadgeRarityKey, BoardCore>;

				return cacheSafe({ badgeStats, totalBadges, achievementLevel, rarity });
			},
			{ staleMs: 120_000 },
		);

		// Per-viewer rank entries (only when a user is signed in).
		let totalBadgesViewer: Partial<BadgeLeaderboardEntry> | undefined;
		let achievementViewer: Partial<BadgeLeaderboardEntry> | undefined;
		let rarityViewer: Record<
			BadgeRarityKey,
			Partial<BadgeLeaderboardEntry> | undefined
		> = {
			common: undefined,
			rare: undefined,
			epic: undefined,
			legendary: undefined,
			mythical: undefined,
			unique: undefined,
		};

		if (userId) {
			const badgesByRarity = new Map<BadgeRarityKey, string[]>();
			for (const stat of global.badgeStats) {
				const list = badgesByRarity.get(stat.rarity) ?? [];
				list.push(stat.badgeCode);
				badgesByRarity.set(stat.rarity, list);
			}

			const [tb, ach, ...rvs] = await Promise.all([
				loadTotalBadgesViewer(userId),
				loadAchievementViewer(userId),
				...rarityKeys.map((rk) =>
					loadRarityViewer(userId, badgesByRarity.get(rk) ?? []),
				),
			]);
			totalBadgesViewer = tb;
			achievementViewer = ach;
			rarityViewer = Object.fromEntries(
				// rk from rarityKeys const, i is array index
				rarityKeys.map((rk, i) => [rk, rvs[i]]),
			) as Record<BadgeRarityKey, Partial<BadgeLeaderboardEntry> | undefined>;
		}

		return apiJson({
			viewerUserId: userId ?? 0,
			badgeStats: global.badgeStats,
			thresholds: THRESHOLDS,
			leaderboards: {
				totalBadges: { ...global.totalBadges, viewerEntry: totalBadgesViewer },
				achievementLevel: {
					...global.achievementLevel,
					viewerEntry: achievementViewer,
				},
				rarity: Object.fromEntries(
					// rk from rarityKeys const
					rarityKeys.map((rk) => [
						rk,
						{ ...global.rarity[rk], viewerEntry: rarityViewer[rk] },
					]),
				) as Record<BadgeRarityKey, BadgeLeaderboardBoard>,
			},
		});
	} catch (err) {
		logger.error("Badge leaderboard error", {
			module: "badges/leaderboard",
			error: String(err),
		});
		return apiJson({
			viewerUserId: 0,
			badgeStats: [],
			thresholds: THRESHOLDS,
			leaderboards: {
				totalBadges: { entries: [], totalPlayers: 0 },
				achievementLevel: { entries: [], totalPlayers: 0 },
				rarity: {
					common: { entries: [], totalPlayers: 0 },
					rare: { entries: [], totalPlayers: 0 },
					epic: { entries: [], totalPlayers: 0 },
					legendary: { entries: [], totalPlayers: 0 },
					mythical: { entries: [], totalPlayers: 0 },
					unique: { entries: [], totalPlayers: 0 },
				},
			},
		});
	}
}
