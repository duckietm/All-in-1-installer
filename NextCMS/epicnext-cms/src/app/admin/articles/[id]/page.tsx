import { eq } from "drizzle-orm";
import { Newspaper } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { deleteArticle, updateArticle } from "@/actions/admin-articles";
import { ArticleForm } from "@/components/admin/article-form";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { articleEditToken } from "@/lib/article-edit-token";
import { db, WebsiteArticles } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function EditArticle({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.NEWS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const { id } = await params;
	const { error } = await searchParams;
	const t = await getTranslations("pages.admin.articles");
	const [article] = await db
		.select({
			id: WebsiteArticles.id,
			slug: WebsiteArticles.slug,
			title: WebsiteArticles.title,
			shortStory: WebsiteArticles.shortStory,
			fullStory: WebsiteArticles.fullStory,
			status: WebsiteArticles.status,
			publishAt: WebsiteArticles.publishAt,
			image: WebsiteArticles.image,
		})
		.from(WebsiteArticles)
		.where(eq(WebsiteArticles.id, BigInt(id)))
		.limit(1)
		.catch(() => []);
	if (!article) notFound();

	return (
		<main>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--admin-accent)]/20 to-[var(--admin-accent)]/5 grid place-items-center">
					<Newspaper size={20} className="text-[var(--admin-accent)]" />
				</div>
				<div>
					<h1 className="m-0 text-xl font-extrabold text-[var(--admin-text)]">
						{t("form.title")}
					</h1>
					<p className="m-0 text-xs text-[var(--admin-text-muted)] mt-0.5">
						<Link href="/admin/articles">← {t("title")}</Link>
					</p>
				</div>
			</div>
			{error ? (
				<p className="text-xs text-[var(--admin-error)] dark:text-[var(--admin-error)] mb-4">
					Error: {error}
				</p>
			) : null}
			<ArticleForm
				userId={String(session.user.id)}
				articleKey={String(article.id)}
				baseToken={articleEditToken(article)}
				action={async (fd) => {
					"use server";
					fd.set("id", String(article.id));
					return updateArticle(fd);
				}}
				defaultValues={{
					title: article.title,
					slug: article.slug,
					image: article.image,
					shortStory: article.shortStory,
					fullStory: article.fullStory,
					status: article.status,
					publishAt: article.publishAt?.toISOString(),
				}}
			/>
			<form action={deleteArticle} style={{ marginTop: "1rem" }}>
				<input type="hidden" name="id" value={String(article.id)} />
				<Button type="submit" variant="default">
					{t("form.deleteArticle")}
				</Button>
			</form>
		</main>
	);
}
