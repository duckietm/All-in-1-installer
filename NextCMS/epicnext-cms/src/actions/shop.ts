"use server";

import { and, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, User, UsersBadges, WebsiteShopArticles } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/server-log";
import { creditsPerUnit } from "@/lib/services/paypal";
import { rcon } from "@/lib/services/rcon";
import { currencyDb, sendCurrency } from "@/lib/services/send-currency";

/**
 * Credits charged for a package row. AtomCMS stores `costs` in cents (USD display);
 * we mirror the top-up rate so $1.00 of list price costs creditsPerUnit() credits.
 */
function creditPriceFromCosts(costs: number): number {
	const rate = creditsPerUnit();
	const dollars = costs < 100 ? 1 : costs / 100;
	return Math.max(1, Math.floor(dollars * rate));
}

function parseBadgeCodes(raw: string | null | undefined): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/[,;]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s.length <= 32);
}

type BuyOutcome = "bought" | "invalid" | "credits" | "ratelimit" | "error";

function shopRedirect(
	categoryId: string,
	outcome: BuyOutcome,
	articleName?: string,
): never {
	const params = new URLSearchParams();
	if (categoryId) params.set("category", categoryId);
	if (outcome === "bought") {
		params.set("bought", "1");
		if (articleName) params.set("package", articleName);
	} else {
		params.set("error", outcome);
	}
	const qs = params.toString();
	redirect(qs ? `/shop?${qs}` : "/shop");
}

function isNextRedirect(e: unknown): boolean {
	return (
		!!e &&
		typeof e === "object" &&
		"digest" in e &&
		typeof (e as { digest?: unknown }).digest === "string" &&
		(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
	);
}

/**
 * Purchase a website shop package with in-game credits (top up via /shop/topup first).
 * The buyer id is always taken from the session, never from FormData.
 */
export async function buyShopArticle(formData: FormData): Promise<void> {
	const categoryId = String(formData.get("categoryId") ?? "")
		.normalize("NFC")
		.trim();
	const safeCategory = /^\d+$/.test(categoryId) ? categoryId : "";

	let outcome: BuyOutcome = "error";
	let packageName = "";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`shop-buy:${userId}`, 5, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const rawId = String(formData.get("articleId") ?? "")
				.normalize("NFC")
				.trim();
			if (!/^\d+$/.test(rawId)) {
				outcome = "invalid";
			} else {
				const [article] = await db
					.select({
						id: WebsiteShopArticles.id,
						name: WebsiteShopArticles.name,
						costs: WebsiteShopArticles.costs,
						credits: WebsiteShopArticles.credits,
						duckets: WebsiteShopArticles.duckets,
						diamonds: WebsiteShopArticles.diamonds,
						badges: WebsiteShopArticles.badges,
						giveRank: WebsiteShopArticles.giveRank,
					})
					.from(WebsiteShopArticles)
					.where(eq(WebsiteShopArticles.id, BigInt(rawId)))
					.limit(1);

				if (!article) {
					outcome = "invalid";
				} else {
					packageName = article.name;
					const price = creditPriceFromCosts(article.costs);

					const [buyer] = await db
						.select({ credits: User.credits, rank: User.rank })
						.from(User)
						.where(eq(User.id, userId))
						.limit(1);
					if (!buyer || buyer.credits < price) {
						outcome = "credits";
					} else {
						const badgeCodes = parseBadgeCodes(article.badges);

						await db.transaction(async (tx) => {
							if (price > 0) {
								await tx
									.update(User)
									.set({ credits: sql`${User.credits} - ${price}` })
									.where(eq(User.id, userId));
							}

							if (
								article.giveRank != null &&
								article.giveRank > 0 &&
								article.giveRank > buyer.rank
							) {
								await tx
									.update(User)
									.set({ rank: article.giveRank })
									.where(eq(User.id, userId));
							}

							for (const code of badgeCodes) {
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
							}
						});

						await sendCurrency(
							{ rcon, db: currencyDb },
							userId,
							"credits",
							article.credits,
						);
						await sendCurrency(
							{ rcon, db: currencyDb },
							userId,
							"duckets",
							article.duckets,
						);
						await sendCurrency(
							{ rcon, db: currencyDb },
							userId,
							"diamonds",
							article.diamonds,
						);

						for (const code of badgeCodes) {
							await rcon.giveBadge(userId, code).catch((error) =>
								logServerError("shop.give_badge_failed", error, {
									userId,
									code,
								}),
							);
						}

						outcome = "bought";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/shop");
	shopRedirect(safeCategory, outcome, packageName || undefined);
}
