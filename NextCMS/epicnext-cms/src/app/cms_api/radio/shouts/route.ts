import { desc, inArray } from "drizzle-orm";
import { apiError, apiJson, publicCacheControl } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import { db, RadioShouts, User } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";
import { moderateOrThrow } from "@/lib/services/moderation";

// Latest 50 radio shouts with their author's username/look resolved. Mirrors the
// query behind the public /radio/shouts page (radio_shouts ordered by created_at
// desc, then joined to users by user_id).

// Max shout length (radio_shouts.message is TEXT; cap to keep posts sane).
const MAX_MESSAGE_LENGTH = 255;

// The shout feed is polled by the radio widget every few seconds — a short
// cache keeps it cheap without delaying new shouts noticeably.
const GET_TTL_SECONDS = 5;

export async function GET(_req: Request) {
	try {
		const data = await redisCache(
			apiCacheKey("radio:shouts"),
			GET_TTL_SECONDS,
			async () => {
				const shouts = await db
					.select({
						id: RadioShouts.id,
						userId: RadioShouts.userId,
						message: RadioShouts.message,
						createdAt: RadioShouts.createdAt,
					})
					.from(RadioShouts)
					.orderBy(desc(RadioShouts.createdAt))
					.limit(50);

				// Resolve author usernames/looks. radio_shouts.user_id is an UnsignedBigInt
				// while users.id is an Int, so narrow to Number for the lookup.
				const authorIds = Array.from(
					new Set(shouts.map((s) => Number(s.userId))),
				);
				const authors = authorIds.length
					? await db
							.select({ id: User.id, username: User.username, look: User.look })
							.from(User)
							.where(inArray(User.id, authorIds))
					: [];
				const authorById = new Map(authors.map((a) => [a.id, a]));

				return shouts.map((s) => {
					const author = authorById.get(Number(s.userId));
					return {
						id: s.id,
						userId: s.userId,
						username: author?.username ?? null,
						look: author?.look ?? null,
						message: s.message,
						createdAt: s.createdAt,
					};
				});
			},
			{ staleMs: 10_000 },
		);

		return apiJson(
			{ shouts: data },
			{ headers: { "cache-control": publicCacheControl(10) } },
		);
	} catch {
		// DB unavailable — serve an empty list rather than a 500.
		return apiJson({ shouts: [] }, { status: 200 });
	}
}

// Post a new radio shout as the Bearer-authed user into radio_shouts.
export async function POST(req: Request) {
	const uid = await bearerUserId(req, ["radio:write"]);
	if (!uid) return apiError("Unauthorized", 401);

	if (!(await rateLimit(`radio-shout:${uid}`, 10, 60_000)).ok) {
		return apiError("Too many shouts. Please wait a minute.", 429);
	}

	const body = (await req.json().catch(() => ({}))) as { message?: unknown };
	const message = typeof body.message === "string" ? body.message.trim() : "";

	if (!message) {
		return apiError("Message is required", 422);
	}
	if (message.length > MAX_MESSAGE_LENGTH) {
		return apiError(
			`Message must be at most ${MAX_MESSAGE_LENGTH} characters`,
			422,
		);
	}

	// The same word filter the server action applies — the API path used to
	// skip it entirely, so a filtered message could be posted with one fetch.
	try {
		await moderateOrThrow(message);
	} catch (error) {
		return apiError((error as Error).message, 422);
	}

	try {
		const now = new Date();
		await db.insert(RadioShouts).values({
			userId: BigInt(uid),
			message,
			createdAt: now,
			updatedAt: now,
		});

		return apiJson({ ok: true });
	} catch {
		// DB write failed — fail soft rather than a 500.
		return apiError("Could not post shout", 503);
	}
}
