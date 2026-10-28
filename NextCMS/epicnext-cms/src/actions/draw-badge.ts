"use server";

import { and, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, User, UsersBadges, WebsiteDrawbadges } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/server-log";
import { rcon } from "@/lib/services/rcon";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * Buy a published community-drawn badge for the SIGNED-IN user. Faithful to
 * AtomCMS's DrawBadgeController buy flow:
 *   - the buyer id is re-read from the session (auth()), NEVER from FormData,
 *     so a crafted form can't purchase on another account;
 *   - only PUBLISHED badges are purchasable;
 *   - the price is a flat, configurable amount (website_settings → the same
 *     `drawbadge.price` key AtomCMS uses), with a safe default;
 *   - the buyer must hold at least `price` credits, which are then deducted;
 *   - the badge is granted live via the emulator (givebadge RCON) and persisted
 *     into users_badges so it survives a relog (mirrors admin giveBadge).
 *
 * website_drawbadges has no price/code columns — the price comes from settings
 * and the emulator badge code is derived from the badge's stored `badge_path`
 * (the sprite filename, e.g. `album1584/MYBADGE.gif` → `MYBADGE`).
 */

const DEFAULT_PRICE = 50;

// The emulator badge code is the badge_path filename without its directory or
// extension, restricted to the code charset the client accepts.
function badgeCodeFromPath(badgePath: string): string {
	const base = badgePath.split(/[\\/]/).pop() ?? badgePath;
	const noExt = base.replace(/\.[^.]+$/, "");
	return noExt.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

async function resolvePrice(): Promise<number> {
	const raw = await siteSettings.get("drawbadge.price", String(DEFAULT_PRICE));
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PRICE;
}

export async function buyBadge(formData: FormData): Promise<void> {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const userId = Number(session.user.id);
	if (!Number.isFinite(userId)) redirect("/login");

	// The form posts the badge row id; everything else (price, code) is resolved
	// server-side from trusted data — never from the client.
	const rawId = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!/^\d+$/.test(rawId)) redirect("/draw-badge?error=invalid");

	let outcome: "bought" | "invalid" | "credits" | "ratelimit" | "fail";
	let boughtCode = "";

	try {
		await clientIp();
		if (!(await rateLimit(`draw-badge-buy:${userId}`, 5, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const [badge] = await db
				.select({
					id: WebsiteDrawbadges.id,
					badgePath: WebsiteDrawbadges.badgePath,
					published: WebsiteDrawbadges.published,
				})
				.from(WebsiteDrawbadges)
				.where(eq(WebsiteDrawbadges.id, BigInt(rawId)))
				.limit(1);

			if (!badge?.published) {
				outcome = "invalid";
			} else {
				const code = badgeCodeFromPath(badge.badgePath);
				if (code.length === 0) {
					outcome = "invalid";
				} else {
					const price = await resolvePrice();

					// Re-read the buyer's live credit balance and verify it covers the cost.
					const [buyer] = await db
						.select({ credits: User.credits })
						.from(User)
						.where(eq(User.id, userId))
						.limit(1);
					if (!buyer || buyer.credits < price) {
						outcome = "credits";
					} else {
						// Atomically deduct credits and persist the badge so a failure
						// between the two operations cannot orphan the user.
						if (price > 0) {
							await db.transaction(async (tx) => {
								await tx
									.update(User)
									.set({ credits: sql`${User.credits} - ${price}` })
									.where(eq(User.id, userId));

								const [existing] = await tx
									.select({ id: UsersBadges.id })
									.from(UsersBadges)
									.where(
										and(
											eq(UsersBadges.userId, userId),
											eq(UsersBadges.badgeCode, code),
										),
									)
									.limit(1);
								if (!existing) {
									const [agg] = await tx
										.select({ maxSlot: max(UsersBadges.slotId) })
										.from(UsersBadges)
										.where(eq(UsersBadges.userId, userId));
									const slotId = (agg?.maxSlot ?? 0) + 1;
									await tx.insert(UsersBadges).values({
										userId,
										slotId,
										badgeCode: code,
									});
								}
							});
						}

						// Grant the badge live so it appears immediately for online users.
						await rcon.giveBadge(userId, code).catch((error) =>
							logServerError("drawbadge.give_failed", error, {
								userId,
								code,
							}),
						);

						outcome = "bought";
						boughtCode = code;
					}
				}
			}
		}
	} catch {
		outcome = "fail";
	}

	revalidatePath("/draw-badge");

	// redirect() throws — it must live OUTSIDE the try/catch.
	if (outcome === "bought") {
		redirect(`/draw-badge?bought=${encodeURIComponent(boughtCode)}`);
	}
	redirect(`/draw-badge?error=${outcome}`);
}
