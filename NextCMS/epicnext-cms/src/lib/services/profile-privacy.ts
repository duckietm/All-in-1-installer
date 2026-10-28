import "server-only";
import { eq, inArray } from "drizzle-orm";
import { WebsiteProfilePrivacy } from "@/db/profile-privacy";
import { db } from "@/lib/db";
export const profilePrivacyKeys = [
	"wallet",
	"online",
	"friends",
	"photos",
	"registered",
] as const;
export type ProfilePrivacy = Record<
	(typeof profilePrivacyKeys)[number],
	boolean
>;
export const defaultProfilePrivacy: ProfilePrivacy = {
	wallet: false,
	online: true,
	friends: true,
	photos: true,
	registered: true,
};
const hiddenProfilePrivacy: ProfilePrivacy = {
	wallet: false,
	online: false,
	friends: false,
	photos: false,
	registered: false,
};
export async function loadProfilePrivacy(userId: number) {
	try {
		const [row] = await db
			.select()
			.from(WebsiteProfilePrivacy)
			.where(eq(WebsiteProfilePrivacy.userId, userId))
			.limit(1);
		return { values: row ?? defaultProfilePrivacy, unavailable: false };
	} catch {
		// A failed privacy lookup must never expose fields whose visibility is unknown.
		return { values: hiddenProfilePrivacy, unavailable: true };
	}
}

function privacyFromRow(
	row: Record<string, unknown> | undefined,
): ProfilePrivacy {
	if (!row) return defaultProfilePrivacy;
	return {
		wallet:
			row.wallet === undefined
				? defaultProfilePrivacy.wallet
				: Boolean(row.wallet),
		online:
			row.online === undefined
				? defaultProfilePrivacy.online
				: Boolean(row.online),
		friends:
			row.friends === undefined
				? defaultProfilePrivacy.friends
				: Boolean(row.friends),
		photos:
			row.photos === undefined
				? defaultProfilePrivacy.photos
				: Boolean(row.photos),
		registered:
			row.registered === undefined
				? defaultProfilePrivacy.registered
				: Boolean(row.registered),
	};
}

/**
 * Bulk variant for lists (leaderboard, search, rosters). One query for all ids
 * and — exactly like the single-row loader — fails closed: a database error
 * returns "hide everything" for every requested user rather than exposing
 * wallet balances or online state of unknown visibility.
 */
export async function loadProfilePrivacyMap(
	userIds: number[],
): Promise<Map<number, ProfilePrivacy>> {
	const ids = [...new Set(userIds)].filter(
		(id) => Number.isInteger(id) && id > 0,
	);
	if (ids.length === 0) return new Map();
	try {
		const rows = await db
			.select()
			.from(WebsiteProfilePrivacy)
			.where(inArray(WebsiteProfilePrivacy.userId, ids));
		const map = new Map<number, ProfilePrivacy>(
			ids.map((id) => [id, defaultProfilePrivacy]),
		);
		for (const row of rows) {
			map.set(
				row.userId,
				privacyFromRow(row as unknown as Record<string, unknown>),
			);
		}
		return map;
	} catch {
		return new Map(ids.map((id) => [id, hiddenProfilePrivacy]));
	}
}
