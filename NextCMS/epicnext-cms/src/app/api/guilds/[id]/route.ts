// Public REST: a single guild (guilds) with its member count
// (guilds_members). AtomCMS JSON API parity. Returns { error } (404) when the
// id is unknown. The owner is the user_id column (accessor userId), surfaced
// here as ownerId.
import { count, eq } from "drizzle-orm";
import { apiJson } from "@/lib/api";
import { db, Guilds, GuildsMembers } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;

	if (!/^\d+$/.test(id)) {
		return apiJson({ error: "Guild not found" }, { status: 404 });
	}
	const guildId = Number(id);

	try {
		const data = await redisCache(
			apiCacheKey(`guilds:${id}`),
			120,
			async () => {
				const [guild] = await db
					.select({
						id: Guilds.id,
						name: Guilds.name,
						description: Guilds.description,
						userId: Guilds.userId,
						roomId: Guilds.roomId,
						badge: Guilds.badge,
						dateCreated: Guilds.dateCreated,
					})
					.from(Guilds)
					.where(eq(Guilds.id, guildId))
					.limit(1);

				if (!guild) {
					return null;
				}

				// Member count is a separate guarded query (no relation is modelled).
				let memberCount = 0;
				try {
					const [row] = await db
						.select({ total: count() })
						.from(GuildsMembers)
						.where(eq(GuildsMembers.guildId, guild.id));
					memberCount = row?.total ?? 0;
				} catch {
					memberCount = 0;
				}

				const { userId, ...rest } = guild;
				return cacheSafe({ data: { ...rest, ownerId: userId, memberCount } });
			},
			{ staleMs: 120_000 },
		);

		if (data === null) {
			return apiJson({ error: "Guild not found" }, { status: 404 });
		}

		return apiJson(data);
	} catch {
		// DB unavailable — treat as not found rather than a 500.
		return apiJson({ error: "Guild not found" }, { status: 200 });
	}
}
