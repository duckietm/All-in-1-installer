import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { postComment } from "@/actions/article-comments";
import { toggleReaction } from "@/actions/article-reactions";
import Link from "@/components/link";
import { JsonLd } from "@/components/public/json-ld";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { SanitizedHtml } from "@/components/shared/sanitized-html";
import { articleSlug } from "@/lib/article-input";
import { auth } from "@/lib/auth";
import { excerpt } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { resolveHotelName } from "@/lib/hotel-name";
import { logger } from "@/lib/logger";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { sanitize } from "@/lib/sanitize";
import {
	absoluteAssetUrl,
	appBaseUrl,
	buildArticleStructuredData,
} from "@/lib/seo";
import {
	getArticleComments,
	getArticleReactions,
	getPublishedArticle,
} from "@/lib/services/news-detail";

type SearchParams = Promise<{
	comment?: string;
	reaction?: string;
	error?: string;
	commentsPage?: string;
}>;

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
	const appUrl = appBaseUrl();
	const slug = articleSlug((await params).slug);
	const article = await getPublishedArticle(slug).catch(() => {
		logger.error("Public article metadata failed", { module: "news" });
		return null;
	});
	if (!article) return { title: "Article" };
	const description = excerpt(article.shortStory, 160);
	const url = `${appUrl}/news/${encodeURIComponent(slug)}`;
	const image =
		absoluteAssetUrl(article.image, appUrl) ??
		`${appUrl}/assets/images/next_header.jpg`;
	const publishedAt = (article.publishedAt ?? article.publishAt)?.toISOString();
	const modifiedAt = (
		article.updatedAt ??
		article.publishedAt ??
		article.publishAt
	)?.toISOString();
	return {
		title: article.title,
		description,
		alternates: { canonical: url },
		openGraph: {
			title: article.title,
			description,
			type: "article",
			url,
			images: [{ url: image, alt: article.title }],
			...(publishedAt ? { publishedTime: publishedAt } : {}),
			...(modifiedAt ? { modifiedTime: modifiedAt } : {}),
			section: "News",
		},
		twitter: {
			card: "summary_large_image",
			title: article.title,
			description,
			images: [image],
		},
	};
}

// The reaction set offered by the voting UI. Must stay in sync with
// ALLOWED_REACTIONS in src/actions/article-reactions.ts.
const REACTIONS: { key: string; emoji: string }[] = [
	{ key: "like", emoji: "👍" },
	{ key: "love", emoji: "❤️" },
	{ key: "wow", emoji: "😮" },
];

async function ArticlePage({
	params,
	searchParams,
}: {
	params: Promise<{ slug: string[] }>;
	searchParams: SearchParams;
}) {
	const slug = articleSlug((await params).slug);
	const { comment, reaction, error, commentsPage } = await searchParams;
	const t = await getTranslations("pages.article");

	let article: Awaited<ReturnType<typeof getPublishedArticle>>;
	try {
		article = await getPublishedArticle(slug);
	} catch {
		logger.error("Public article lookup failed", { module: "news" });
		return (
			<section className="page-grid">
				<ContentCard icon="📰" title={t("loadError")}>
					<p role="alert">{t("loadError")}</p>
					<a
						className="btn btn-outline"
						href={`/news/${encodeURIComponent(slug)}`}
					>
						{t("retry")}
					</a>
				</ContentCard>
			</section>
		);
	}
	if (!article) notFound();

	const articleId = article.id;

	const session = await auth();
	const loggedIn = Boolean(session?.user?.id);
	const sessionUserId = session?.user?.id ? Number(session.user.id) : null;

	const requestedPage =
		comment === "posted" && !commentsPage ? "last" : Number(commentsPage ?? 1);
	const [reactions, commentsResult, hotelName] = await Promise.all([
		getArticleReactions(articleId, sessionUserId).catch(() => {
			logger.error("Public article reactions failed", {
				module: "news",
				articleId: String(articleId),
			});
			return null;
		}),
		getArticleComments(articleId, requestedPage).catch(() => {
			logger.error("Public article comments failed", {
				module: "news",
				articleId: String(articleId),
			});
			return null;
		}),
		resolveHotelName(),
	]);
	const reactionCounts = reactions?.counts ?? new Map<string, number>();
	const myReaction = reactions?.myReaction ?? null;
	const comments = commentsResult?.rows ?? [];
	const articleHref = `/news/${encodeURIComponent(slug)}`;
	const structuredDataUrl = `${appBaseUrl()}/news/${encodeURIComponent(slug)}`;
	const structuredData = buildArticleStructuredData({
		hotelName,
		url: structuredDataUrl,
		title: article.title,
		description: excerpt(article.shortStory, 160),
		image: absoluteAssetUrl(article.image, appBaseUrl()),
		logo: absoluteAssetUrl(article.image, appBaseUrl()),
		publishedAt: (article.publishedAt ?? article.publishAt)?.toISOString(),
		modifiedAt: (
			article.updatedAt ??
			article.publishedAt ??
			article.publishAt
		)?.toISOString(),
	});
	const commentsHref = (page: number) =>
		`${articleHref}?commentsPage=${page}#comments`;
	const retryHref = commentsPage
		? `${articleHref}?${new URLSearchParams({ commentsPage })}`
		: articleHref;

	const errorMessage =
		error === "empty"
			? t("errors.empty")
			: error === "moderated"
				? t("errors.moderated")
				: error === "ratelimit"
					? t("errors.ratelimit")
					: error === "invalid"
						? t("errors.invalid")
						: error === "not_found"
							? t("errors.notFound")
							: error
								? t("errors.error")
								: null;

	return (
		<section className="page-grid">
			<JsonLd data={structuredData} />
			{comment === "posted" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.posted")}
				</div>
			) : null}
			{reaction === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.reaction")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<ContentCard
				icon="📰"
				title={article.title}
				subtitle={
					(article.publishAt ?? article.createdAt)
						? formatDate(article.publishAt ?? article.createdAt, "date")
						: undefined
				}
				action={
					<Link className="btn btn-outline" href="/news">
						{t("backToNews")}
					</Link>
				}
			>
				{article.image ? (
					<img
						src={article.image}
						alt=""
						decoding="async"
						loading="eager"
						// Reserve the box: an unbounded hero image shifts the whole
						// article down once the bitmap decodes.
						style={{
							width: "100%",
							aspectRatio: "16 / 9",
							objectFit: "cover",
							borderRadius: 10,
							margin: "0 0 1rem",
						}}
					/>
				) : null}
				{/* Article body is rich HTML (atom uses TinyMCE) — sanitised server-side. */}
				<SanitizedHtml
					html={sanitize(article.fullStory)}
					className="article-body"
				/>
			</ContentCard>

			{/* ── Reactions ─────────────────────────────────────────── */}
			<ContentCard
				icon="💬"
				title={t("reactionsTitle")}
				subtitle={t("reactionsSubtitle")}
			>
				{!reactions ? (
					<div role="alert">
						<p>{t("reactionsUnavailable")}</p>
						<a className="btn btn-outline" href={retryHref}>
							{t("retry")}
						</a>
					</div>
				) : loggedIn ? (
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
						{REACTIONS.map((r) => {
							const active = myReaction === r.key;
							const count = reactionCounts.get(r.key) ?? 0;
							const label = `${r.emoji} ${t(`reaction.${r.key}`)}`;
							return (
								<form key={r.key} action={toggleReaction} style={{ margin: 0 }}>
									<input
										type="hidden"
										name="articleId"
										value={String(articleId)}
									/>
									<input type="hidden" name="slug" value={article.slug} />
									<input type="hidden" name="reaction" value={r.key} />
									<button
										type="submit"
										aria-pressed={active}
										className={`btn ${active ? "btn-primary" : "btn-outline"}`}
										title={
											active
												? t("removeReaction")
												: t("reactWith", { reaction: r.key })
										}
									>
										<span>{label}</span>
										<span
											className="muted"
											style={{
												fontSize: "0.85rem",
												color: "inherit",
												opacity: 0.85,
											}}
										>
											{count}
										</span>
									</button>
								</form>
							);
						})}
					</div>
				) : reactionCounts.size === 0 ? (
					<EmptyState icon="💬">
						{t("noReactions")} <Link href="/login">{t("logIn")}</Link>{" "}
						{t("toReact")}
					</EmptyState>
				) : (
					<>
						<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
							{REACTIONS.filter(
								(r) => (reactionCounts.get(r.key) ?? 0) > 0,
							).map((r) => (
								<span key={r.key} className="currency">
									<span
										style={{ fontWeight: 800 }}
									>{`${r.emoji} ${t(`reaction.${r.key}`)}`}</span>
									<span className="muted" style={{ fontSize: "0.85rem" }}>
										{reactionCounts.get(r.key) ?? 0}
									</span>
								</span>
							))}
						</div>
						<p className="muted" style={{ marginTop: "0.6rem" }}>
							<Link href="/login">{t("logIn")}</Link> {t("toReact")}
						</p>
					</>
				)}
			</ContentCard>

			{/* ── Comments ──────────────────────────────────────────── */}
			<section id="comments" aria-label={t("commentsTitle")}>
				<ContentCard
					icon="🗨️"
					title={t("commentsTitle")}
					subtitle={
						commentsResult && commentsResult.total > 0
							? t("commentsCount", { count: commentsResult.total })
							: t("commentsSubtitle")
					}
				>
					{!commentsResult ? (
						<div role="alert">
							<p>{t("commentsUnavailable")}</p>
							<a className="btn btn-outline" href={`${retryHref}#comments`}>
								{t("retry")}
							</a>
						</div>
					) : comments.length === 0 ? (
						<EmptyState icon="🗨️">{t("noComments")}</EmptyState>
					) : (
						<div className="grid" style={{ marginBottom: "1.5rem" }}>
							{comments.map((c) => {
								const name = c.username;
								return (
									<article key={String(c.id)} className="card">
										<p
											className="muted"
											style={{ marginTop: 0, marginBottom: "0.35rem" }}
										>
											{name ? (
												<Link href={`/u/${name}`}>{name}</Link>
											) : (
												<span>{t("userNumber", { id: c.userId })}</span>
											)}
											{c.createdAt ? (
												<span> · {formatDate(c.createdAt, "date", "")}</span>
											) : null}
										</p>
										<p
											style={{
												margin: 0,
												whiteSpace: "pre-wrap",
												overflowWrap: "anywhere",
											}}
										>
											{c.comment}
										</p>
									</article>
								);
							})}
						</div>
					)}

					{commentsResult && commentsResult.lastPage > 1 ? (
						<nav
							aria-label={t("commentsPagination")}
							className="flex flex-wrap items-center justify-between gap-3"
							style={{ marginBottom: "1rem" }}
						>
							{commentsResult.page > 1 ? (
								<Link
									className="btn btn-outline"
									href={commentsHref(commentsResult.page - 1)}
								>
									{t("previous")}
								</Link>
							) : (
								<span />
							)}
							<span>
								{t("commentsPageSummary", {
									page: commentsResult.page,
									pages: commentsResult.lastPage,
									total: commentsResult.total,
								})}
							</span>
							{commentsResult.page < commentsResult.lastPage ? (
								<Link
									className="btn btn-outline"
									href={commentsHref(commentsResult.page + 1)}
								>
									{t("next")}
								</Link>
							) : (
								<span />
							)}
						</nav>
					) : null}

					{loggedIn ? (
						<form action={postComment} className="card">
							<input type="hidden" name="articleId" value={String(articleId)} />
							<input type="hidden" name="slug" value={slug} />
							<label
								htmlFor="comment"
								style={{
									display: "block",
									fontWeight: 700,
									marginBottom: "0.5rem",
								}}
							>
								{t("addComment")}
							</label>
							<textarea
								id="comment"
								name="comment"
								required
								maxLength={255}
								rows={3}
								placeholder={t("commentPlaceholder")}
								style={{ width: "100%", resize: "vertical" }}
							/>
							<div style={{ marginTop: "0.75rem" }}>
								<button type="submit" className="btn btn-primary">
									{t("postComment")}
								</button>
							</div>
						</form>
					) : (
						<p className="muted">
							<Link href="/login">{t("logIn")}</Link> {t("toComment")}
						</p>
					)}
				</ContentCard>
			</section>
		</section>
	);
}

export default withPublicPagePerformance("/news/[slug]", ArticlePage);
