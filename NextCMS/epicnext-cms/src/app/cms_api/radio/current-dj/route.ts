import { eq } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, User } from "@/lib/db";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";
import { siteSettings } from "@/lib/services/site-settings";

// Current on-air DJ. The DJ is set manually via the radio_current_dj_id setting
// (Manual DJ user ID). When set, resolve that user's username/look; otherwise
// there is no DJ on air. Mirrors the AtomCMS radio "on air" widget.

// The radio widget polls this endpoint frequently — a short cache avoids a DB
// hit per poll. The DJ only changes when a moderator switches it manually.
const GET_TTL_SECONDS = 5;

export async function GET(_req: Request) {
	try {
		const dj = await redisCache(
			apiCacheKey("radio:current-dj"),
			GET_TTL_SECONDS,
			async () => {
				const raw = await siteSettings.get("radio_current_dj_id", "");
				const id = Number(raw);

				// No DJ configured (empty / non-numeric / zero).
				if (!raw || !Number.isFinite(id) || id <= 0) {
					return null;
				}

				const [user] = await db
					.select({ username: User.username, look: User.look })
					.from(User)
					.where(eq(User.id, id))
					.limit(1);

				if (!user) {
					return null;
				}

				return { username: user.username, look: user.look };
			},
			{ staleMs: 30_000 },
		);

		return apiJson(
			{ dj },
			{ headers: { "cache-control": publicCacheControl(30) } },
		);
	} catch {
		// DB / settings unavailable — no DJ rather than a 500.
		return apiJson({ dj: null }, { status: 200 });
	}
}
