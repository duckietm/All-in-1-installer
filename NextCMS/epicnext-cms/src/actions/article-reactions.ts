"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, WebsiteArticleReactions, WebsiteArticles } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// The reaction set the UI offers. The action rejects anything outside this list
// so the website_article_reactions.reaction VARCHAR(50) only ever holds known
// values. Keep this in sync with REACTIONS in src/app/news/[slug]/page.tsx.
const ALLOWED_REACTIONS = new Set(["like", "love", "wow"]);

type ReactionOutcome =
	| "updated"
	| "invalid"
	| "not_found"
	| "ratelimit"
	| "error";

function reactionRedirect(slug: string, outcome: ReactionOutcome): never {
	const path = slug ? `/news/${encodeURIComponent(slug)}` : "/news";
	if (outcome === "updated") redirect(`${path}?reaction=1`);
	redirect(`${path}?error=${outcome}`);
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
 * Toggle the SIGNED-IN user's reaction on a news article.
 */
export async function toggleReaction(formData: FormData): Promise<void> {
	const slugHint = String(formData.get("slug") ?? "")
		.normalize("NFC")
		.trim();

	let outcome: ReactionOutcome = "error";
	let slug = slugHint;

	try {
		const session = await auth();
		if (!session?.user?.id) {
			redirect("/login");
		}

		const userId = Number(session.user.id);
		if (!Number.isFinite(userId)) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`article-reaction:${userId}`, 30, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const reaction = String(formData.get("reaction") ?? "")
				.normalize("NFC")
				.trim()
				.toLowerCase();
			if (!ALLOWED_REACTIONS.has(reaction)) {
				outcome = "invalid";
			} else {
				const articleIdRaw = String(formData.get("articleId") ?? "")
					.normalize("NFC")
					.trim();
				if (!/^\d+$/.test(articleIdRaw)) {
					outcome = "invalid";
				} else {
					const articleId = BigInt(articleIdRaw);

					const [article] = await db
						.select({ slug: WebsiteArticles.slug })
						.from(WebsiteArticles)
						.where(eq(WebsiteArticles.id, articleId))
						.limit(1);
					if (!article) {
						outcome = "not_found";
					} else {
						slug = article.slug;

						const [existing] = await db
							.select({
								id: WebsiteArticleReactions.id,
								active: WebsiteArticleReactions.active,
							})
							.from(WebsiteArticleReactions)
							.where(
								and(
									eq(WebsiteArticleReactions.userId, userId),
									eq(WebsiteArticleReactions.articleId, articleId),
									eq(WebsiteArticleReactions.reaction, reaction),
								),
							)
							.limit(1);

						if (existing?.active) {
							await db
								.update(WebsiteArticleReactions)
								.set({ active: false })
								.where(eq(WebsiteArticleReactions.id, existing.id));
						} else {
							await db
								.update(WebsiteArticleReactions)
								.set({ active: false })
								.where(
									and(
										eq(WebsiteArticleReactions.userId, userId),
										eq(WebsiteArticleReactions.articleId, articleId),
										eq(WebsiteArticleReactions.active, true),
									),
								);

							if (existing) {
								await db
									.update(WebsiteArticleReactions)
									.set({ active: true })
									.where(eq(WebsiteArticleReactions.id, existing.id));
							} else {
								await db.insert(WebsiteArticleReactions).values({
									userId,
									articleId,
									reaction,
									active: true,
								});
							}
						}
						outcome = "updated";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (slug && outcome !== "error") revalidatePath(`/news/${slug}`);
	reactionRedirect(slug, outcome);
}
