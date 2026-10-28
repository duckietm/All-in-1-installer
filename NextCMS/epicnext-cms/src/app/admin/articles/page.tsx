import { Newspaper } from "lucide-react";
import Form from "next/form";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { ArticleCard } from "@/components/admin/article-card";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { loadArticleList } from "@/lib/services/article-list";
import { ArticleListSubmit } from "./list-submit";

export default async function AdminArticles({
	searchParams,
}: {
	searchParams: Promise<{
		error?: string;
		search?: string;
		status?: string;
		page?: string;
	}>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.NEWS_VIEW, session.user.rank))
		redirect("/admin");
	const params = await searchParams;
	const t = await getTranslations("pages.admin.articles");
	let result: Awaited<ReturnType<typeof loadArticleList>> | null = null;
	try {
		result = await loadArticleList({
			status: params.status,
			search: params.search,
			page: Number(params.page ?? 1),
		});
	} catch {
		/* Render a retry state instead of an empty article list. */
	}
	const status =
		result?.status ??
		(["draft", "published", "scheduled"].includes(params.status ?? "")
			? params.status
			: "all");
	const search = result?.search ?? (params.search ?? "").slice(0, 191);
	const href = (page: number) =>
		`/admin/articles?${new URLSearchParams({ status: status ?? "all", search, page: String(page) })}`;
	return (
		<AdminPageShell
			icon={Newspaper}
			title={t("title")}
			subtitle={t("subtitle")}
			actions={
				canAccess(permissions, PERMS.NEWS_EDIT, session.user.rank) ? (
					<Button asChild>
						<Link href="/admin/articles/new">{t("newArticle")}</Link>
					</Button>
				) : undefined
			}
		>
			{params.error ? (
				<p role="alert" className="text-sm text-[var(--admin-error)] mb-4">
					{t("listActionError")}
				</p>
			) : null}
			<Form
				action="/admin/articles"
				className="admin-card mb-5 flex flex-wrap items-end gap-3"
				key={`${status}:${search}`}
			>
				<label htmlFor="article-status" className="grid gap-1 text-sm">
					<span>{t("listStatus")}</span>
					<select
						id="article-status"
						name="status"
						defaultValue={status}
						className="h-9 rounded-md border bg-[var(--admin-surface)] px-3"
					>
						{["all", "draft", "published", "scheduled"].map((value) => (
							<option value={value} key={value}>
								{t(`listStatus_${value}`)}
							</option>
						))}
					</select>
				</label>
				<label
					htmlFor="article-search"
					className="grid flex-1 min-w-0 gap-1 text-sm"
				>
					<span>{t("listSearch")}</span>
					<Input
						id="article-search"
						name="search"
						defaultValue={search}
						maxLength={191}
					/>
				</label>
				<ArticleListSubmit />
				<Button variant="outline" asChild>
					<Link href="/admin/articles">{t("listReset")}</Link>
				</Button>
			</Form>
			{!result ? (
				<div className="admin-card space-y-3" role="alert">
					<p>{t("listUnavailable")}</p>
					<Link
						className="btn btn-outline"
						href={href(Number(params.page) || 1)}
					>
						{t("listRetry")}
					</Link>
				</div>
			) : (
				<>
					<p className="mb-4 text-sm text-[var(--admin-text-muted)]">
						{t("listTotal", { count: result.total })}
					</p>
					{result.rows.length === 0 ? (
						<div className="admin-empty">
							{search || status !== "all"
								? t("listNoMatches")
								: t("noArticles")}
						</div>
					) : (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4">
							{result.rows.map((article) => (
								<div key={String(article.id)} className="min-w-0 space-y-2">
									<span className="text-xs text-[var(--admin-text-muted)]">
										{["draft", "published", "scheduled"].includes(
											article.status,
										)
											? t(`listStatus_${article.status}`)
											: article.status}
									</span>
									<ArticleCard
										id={String(article.id)}
										title={article.title}
										image={article.image}
										createdAt={article.createdAt?.toISOString() ?? null}
										author={article.author ?? undefined}
									/>
								</div>
							))}
						</div>
					)}
					<nav
						aria-label={t("listPagination")}
						className="mt-5 flex flex-wrap items-center justify-between gap-3"
					>
						{result.page > 1 ? (
							<Link className="btn btn-outline" href={href(result.page - 1)}>
								{t("listPrevious")}
							</Link>
						) : (
							<span />
						)}
						<span className="text-sm">
							{t("listPage", { page: result.page, total: result.lastPage })}
						</span>
						{result.page < result.lastPage ? (
							<Link className="btn btn-outline" href={href(result.page + 1)}>
								{t("listNext")}
							</Link>
						) : (
							<span />
						)}
					</nav>
				</>
			)}
		</AdminPageShell>
	);
}
