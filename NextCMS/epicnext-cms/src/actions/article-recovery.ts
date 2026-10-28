"use server";
import { and, desc, eq } from "drizzle-orm";
import { ArticleDrafts, ArticleRevisions } from "@/db/article-editor";
import { requirePermission } from "@/lib/admin/guard";
import {
	type ArticleDraft,
	articleKey,
	readArticleDraft,
} from "@/lib/article-draft";
import { db, WebsiteArticles } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export async function loadArticleRecovery(key: string) {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	key = articleKey(key);
	const [draft] = await db
		.select()
		.from(ArticleDrafts)
		.where(
			and(
				eq(ArticleDrafts.userId, staff.id),
				eq(ArticleDrafts.articleKey, key),
			),
		)
		.limit(1);
	const revisions =
		key === "new"
			? []
			: await db
					.select()
					.from(ArticleRevisions)
					.where(eq(ArticleRevisions.articleId, BigInt(key)))
					.orderBy(desc(ArticleRevisions.id))
					.limit(20);
	return {
		version: draft?.version ?? 0,
		draft:
			draft && draft.payload !== "{}"
				? {
						version: draft.version,
						payload: JSON.parse(draft.payload) as ArticleDraft,
					}
				: null,
		revisions: revisions.map((r) => ({
			id: r.id,
			createdAt: r.createdAt.toISOString(),
			payload: JSON.parse(r.payload) as ArticleDraft,
		})),
	};
}
export async function autosaveArticle(
	key: string,
	expectedVersion: number,
	form: FormData,
) {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	key = articleKey(key);
	const payload = JSON.stringify(readArticleDraft(form));
	if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
		throw new Error("draftInvalid");
	return db.transaction(async (tx) => {
		if (key !== "new") {
			const [article] = await tx
				.select({ id: WebsiteArticles.id })
				.from(WebsiteArticles)
				.where(eq(WebsiteArticles.id, BigInt(key)))
				.limit(1)
				.for("update");
			if (!article) return { ok: false as const };
		}
		await tx
			.insert(ArticleDrafts)
			.values({ userId: staff.id, articleKey: key, version: 0, payload: "{}" })
			.onDuplicateKeyUpdate({ set: { articleKey: key } });
		const where = and(
			eq(ArticleDrafts.userId, staff.id),
			eq(ArticleDrafts.articleKey, key),
		);
		const [draft] = await tx
			.select()
			.from(ArticleDrafts)
			.where(where)
			.for("update");
		if (!draft || draft.version !== expectedVersion)
			return { ok: false as const };
		await tx
			.update(ArticleDrafts)
			.set({ payload, version: expectedVersion + 1, updatedAt: new Date() })
			.where(where);
		return { ok: true as const, version: expectedVersion + 1 };
	});
}

export async function clearArticleRecovery(
	key: string,
	expectedVersion: number,
) {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	key = articleKey(key);
	await db
		.update(ArticleDrafts)
		.set({ payload: "{}", version: expectedVersion + 1, updatedAt: new Date() })
		.where(
			and(
				eq(ArticleDrafts.userId, staff.id),
				eq(ArticleDrafts.articleKey, key),
				eq(ArticleDrafts.version, expectedVersion),
			),
		);
}
