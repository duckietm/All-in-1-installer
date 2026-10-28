"use server";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArticleDrafts, ArticleRevisions } from "@/db/article-editor";
import { historySnapshot, recordHistory } from "@/features/history/server";
import { enqueueEffect, runOperation } from "@/features/operations/server";
import { requirePermission } from "@/lib/admin/guard";
import { articleEditToken } from "@/lib/article-edit-token";
import {
	ArticleInputError,
	type ArticleSaveResult,
	articleInputField,
	readArticleInput,
} from "@/lib/article-input";
import {
	db,
	rowsFrom,
	WebsiteArticleComments,
	WebsiteArticleReactions,
	WebsiteArticles,
} from "@/lib/db";
import { formPositiveBigInt } from "@/lib/form-data";
import { slugify } from "@/lib/format";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { invalidateNewsCache } from "@/lib/services/news-cache";
import { notify } from "@/lib/services/webhook";

async function uniqueSlug(
	title: string,
	excludeId?: bigint,
	connection: Pick<typeof db, "select"> = db,
): Promise<string> {
	const base = slugify(title);
	let slug = base;
	for (let n = 2; ; n++) {
		const [existing] = await connection
			.select({ id: WebsiteArticles.id })
			.from(WebsiteArticles)
			.where(
				and(
					eq(WebsiteArticles.slug, slug),
					excludeId ? ne(WebsiteArticles.id, excludeId) : undefined,
				),
			)
			.limit(1);
		if (!existing) return slug;
		const suffix = `-${n}`;
		slug = base.slice(0, 255 - suffix.length) + suffix;
	}
}
async function saveFailure(
	error: unknown,
	operation: string,
): Promise<ArticleSaveResult> {
	const t = await getTranslations("pages.admin.articles.form");
	if (error instanceof ArticleInputError) {
		const field = articleInputField(error.code);
		return {
			ok: false,
			error: t(error.code),
			...(field ? { fieldErrors: { [field]: [t(error.code)] } } : {}),
		};
	}
	const reference = logger.error("News save failed", {
		module: "news",
		operation,
		error,
	});
	return { ok: false, error: t("saveFailedReference", { reference }) };
}
async function refreshNews() {
	await invalidateNewsCache();
	revalidatePath("/admin/articles");
	revalidatePath("/news", "layout");
	revalidatePath("/me");
	revalidatePath("/");
}
function operationInput(
	form: FormData,
	input: ReturnType<typeof readArticleInput>,
) {
	return {
		...input,
		fullStory: createHash("sha256").update(input.fullStory).digest("hex"),
		publishAt: input.publishAt?.toISOString() ?? null,
		id: String(form.get("id") ?? ""),
		baseToken: String(form.get("baseToken") ?? ""),
	};
}
async function refreshSavedNews(id?: bigint) {
	try {
		await refreshNews();
		if (id) revalidatePath(`/admin/articles/${id}`);
	} catch (error) {
		logger.error("News saved; cache refresh will be retried", {
			module: "news",
			error,
		});
	}
}
export async function createArticle(
	formData: FormData,
): Promise<ArticleSaveResult> {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	let notification: Parameters<typeof notify>[0] | undefined;
	try {
		const input = readArticleInput(formData);
		await runOperation(
			{
				actorId: staff.id,
				kind: "news.create",
				key: String(formData.get("requestKey") ?? randomUUID()),
				input: operationInput(formData, input),
			},
			async (tx, operationId) => {
				const { rawSlug, ...fields } = input;
				const slug = await uniqueSlug(rawSlug || fields.title, undefined, tx);
				const now = new Date();
				await tx.insert(WebsiteArticles).values({
					...fields,
					slug,
					userId: staff.id,
					createdAt: now,
					updatedAt: now,
					publishedAt: fields.status === "published" ? now : null,
				});
				const articleId = rowsFrom<{ id: string }>(
					await tx.execute(sql`SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id`),
				)[0]?.id;
				if (!articleId || !/^[1-9][0-9]*$/.test(articleId))
					throw new Error("Article identity unavailable");
				await enqueueEffect(tx, operationId, "news.refresh");
				if (input.status === "published")
					notification = {
						action: "news_publish",
						actor: staff.username,
						target: input.title,
						details: slug,
					};
				return { ok: true, articleId, articleTitle: input.title };
			},
		);
	} catch (error) {
		return saveFailure(error, "create");
	}
	if (notification) {
		try {
			notify(notification);
		} catch (error) {
			logger.error("News notification failed", { module: "news", error });
		}
	}
	await refreshSavedNews();
	return { ok: true, data: { redirectTo: "/admin/articles" } };
}
export async function updateArticle(
	formData: FormData,
): Promise<ArticleSaveResult> {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	const t = await getTranslations("pages.admin.articles.form");
	const id = formPositiveBigInt(formData, "id");
	if (!id) return { ok: false, error: t("articleNotFound") };
	let input: ReturnType<typeof readArticleInput>;
	let becamePublished = false;
	let slug = "";
	try {
		input = readArticleInput(formData);
		await runOperation(
			{
				actorId: staff.id,
				kind: "news.update",
				key: String(formData.get("requestKey") ?? randomUUID()),
				input: operationInput(formData, input),
			},
			async (tx, operationId) => {
				const [existing] = await tx
					.select()
					.from(WebsiteArticles)
					.where(eq(WebsiteArticles.id, id))
					.limit(1)
					.for("update");
				if (!existing) throw new ArticleInputError("articleNotFound");
				if (formData.get("baseToken") !== articleEditToken(existing))
					throw new ArticleInputError("editConflict");
				const historyId = String(id);
				const historyBefore = await historySnapshot(tx, "news", historyId);
				await tx.insert(ArticleRevisions).values({
					articleId: id,
					userId: staff.id,
					payload: JSON.stringify({
						title: existing.title,
						slug: existing.slug,
						image: existing.image,
						shortStory: existing.shortStory,
						fullStory: existing.fullStory,
						status: existing.status,
						publishAt: existing.publishAt?.toISOString() ?? "",
						baseToken: "",
					}),
				});
				const { rawSlug, ...fields } = input;
				const requestedSlug = rawSlug ? slugify(rawSlug) : existing.slug;
				slug =
					requestedSlug === existing.slug
						? existing.slug
						: await uniqueSlug(requestedSlug, id, tx);
				becamePublished =
					fields.status === "published" && existing.status !== "published";
				await tx
					.update(WebsiteArticles)
					.set({
						...fields,
						slug,
						publishedAt:
							fields.status === "published"
								? (existing.publishedAt ?? new Date())
								: null,
						updatedAt: new Date(),
					})
					.where(eq(WebsiteArticles.id, id));
				await recordHistory(tx, "news", historyId, staff.id, historyBefore);
				await enqueueEffect(tx, operationId, "news.refresh");
				return { ok: true, articleId: String(id), articleTitle: input.title };
			},
		);
	} catch (error) {
		return saveFailure(error, "update");
	}
	if (becamePublished) {
		try {
			notify({
				action: "news_publish",
				actor: staff.username,
				target: input.title,
				details: slug,
			});
		} catch (error) {
			logger.error("News notification failed", { module: "news", error });
		}
	}
	await refreshSavedNews(id);
	return { ok: true, data: { redirectTo: "/admin/articles" } };
}

export async function deleteArticle(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.NEWS_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) redirect("/admin/articles?error=Missing article id");
	const [article] = await db
		.select({ title: WebsiteArticles.title })
		.from(WebsiteArticles)
		.where(eq(WebsiteArticles.id, id))
		.limit(1);
	try {
		await db.transaction(async (tx) => {
			await tx
				.delete(WebsiteArticleReactions)
				.where(eq(WebsiteArticleReactions.articleId, id));
			await tx
				.delete(WebsiteArticleComments)
				.where(eq(WebsiteArticleComments.articleId, id));
			await tx
				.delete(ArticleRevisions)
				.where(eq(ArticleRevisions.articleId, id));
			await tx
				.delete(ArticleDrafts)
				.where(eq(ArticleDrafts.articleKey, String(id)));
			await tx.delete(WebsiteArticles).where(eq(WebsiteArticles.id, id));
		});

		notify({
			action: "news_delete",
			actor: staff.username,
			target: article?.title ?? String(id),
		});
	} catch (error) {
		logger.error("News deletion failed", { module: "news", error });
		redirect("/admin/articles?error=Delete failed");
	}
	await refreshNews();
	redirect("/admin/articles");
}
