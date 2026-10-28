import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db, WebsiteArticleComments, WebsiteArticles } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { isAllowed } from "@/lib/services/moderation";

export type ArticleCommentTarget = { id: string } | { slug: string };
export type ArticleCommentResult =
	| { ok: true; slug: string }
	| {
			ok: false;
			reason:
				| "empty"
				| "too_long"
				| "invalid"
				| "moderated"
				| "ratelimit"
				| "not_found";
			retryAfter?: number;
	  };

/** Authenticated callers share the same quota and uncached publication check. */
export async function submitArticleComment({
	userId,
	target,
	comment: rawComment,
}: {
	userId: number;
	target: ArticleCommentTarget;
	comment: unknown;
}): Promise<ArticleCommentResult> {
	if (!Number.isSafeInteger(userId) || userId <= 0)
		return { ok: false, reason: "invalid" };
	// Preserve the site's five-attempt burst; API and form consume one bucket.
	const limit = await rateLimit(`comment:${userId}`, 5, 30_000);
	if (!limit.ok)
		return { ok: false, reason: "ratelimit", retryAfter: limit.retryAfter };

	const comment =
		typeof rawComment === "string" ? rawComment.normalize("NFC").trim() : "";
	if (!comment) return { ok: false, reason: "empty" };
	if (comment.length > 255) return { ok: false, reason: "too_long" };

	let articleId = 0n;
	if ("id" in target) {
		if (!/^\d{1,20}$/.test(target.id)) return { ok: false, reason: "invalid" };
		articleId = BigInt(target.id);
		if (articleId <= 0n || articleId > 18446744073709551615n)
			return { ok: false, reason: "invalid" };
	} else if (!target.slug || target.slug.length > 255) {
		return { ok: false, reason: "invalid" };
	}
	if (!(await isAllowed(comment)).ok) return { ok: false, reason: "moderated" };

	// Moderate before locking: the optional remote check can take several seconds.
	// A locking read sees current publication state and serializes withdrawal/deletion
	// with this insert, rather than trusting a prior page or cached article lookup.
	return db.transaction(async (tx): Promise<ArticleCommentResult> => {
		const [article] = await tx
			.select({ id: WebsiteArticles.id, slug: WebsiteArticles.slug })
			.from(WebsiteArticles)
			.where(
				and(
					"slug" in target
						? eq(WebsiteArticles.slug, target.slug)
						: eq(WebsiteArticles.id, articleId),
					eq(WebsiteArticles.status, "published"),
					or(
						sql`${WebsiteArticles.publishAt} IS NULL`,
						sql`${WebsiteArticles.publishAt} <= NOW()`,
					),
				),
			)
			.limit(1)
			.for("update");
		if (!article) return { ok: false, reason: "not_found" };
		const now = new Date();
		await tx.insert(WebsiteArticleComments).values({
			articleId: article.id,
			userId,
			comment,
			createdAt: now,
			updatedAt: now,
		});
		return { ok: true, slug: article.slug };
	});
}
