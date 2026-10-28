import Image from "next/image";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { excerpt } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { logger } from "@/lib/logger";
import { withPublicPagePerformance } from "@/lib/public-page-performance";
import { loadNewsArchive } from "@/lib/services/news-archive";

export const metadata = { title: "News" };

async function NewsPage({
	searchParams,
}: {
	searchParams: Promise<{ q?: string; page?: string; order?: string }>;
}) {
	const t = await getTranslations("pages.news");

	const params = await searchParams;
	const result = await loadNewsArchive({
		search: params.q,
		page: Number(params.page ?? 1),
		order: params.order,
	}).catch((error) => {
		logger.error("Public news archive failed", { module: "news", error });
		return null;
	});
	const articles = result?.rows ?? [];
	const href = (page: number) =>
		`/news?${new URLSearchParams({ q: result?.search ?? params.q ?? "", order: result?.order ?? "newest", page: String(page) })}`;

	return (
		<section className="page-grid">
			<ContentCard icon="📰" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard>
				<form
					action="/news"
					method="GET"
					className="flex flex-wrap items-end gap-3"
				>
					<label className="flex min-w-0 flex-1 flex-col gap-1">
						{t("searchLabel")}
						<input
							name="q"
							defaultValue={params.q}
							maxLength={191}
							className="input w-full"
						/>
					</label>
					<label className="flex flex-col gap-1">
						{t("orderLabel")}
						<select
							name="order"
							defaultValue={params.order === "oldest" ? "oldest" : "newest"}
							className="input"
						>
							<option value="newest">{t("newest")}</option>
							<option value="oldest">{t("oldest")}</option>
						</select>
					</label>
					<button type="submit" className="btn btn-primary">
						{t("apply")}
					</button>
				</form>
			</ContentCard>
			<ContentCard padded={articles.length === 0}>
				{!result ? (
					<p role="alert">{t("loadError")}</p>
				) : articles.length === 0 ? (
					<EmptyState icon="📰">{t("noArticles")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{articles.map((a) => (
							<Link
								key={a.slug}
								href={`/news/${a.slug}`}
								className="card hover"
								style={{
									display: "flex",
									flexDirection: "column",
									textDecoration: "none",
									padding: 0,
									overflow: "hidden",
								}}
							>
								{a.image ? (
									<div
										style={{
											position: "relative",
											width: "100%",
											aspectRatio: "16/9",
										}}
									>
										<Image
											src={a.image}
											alt=""
											fill
											sizes="(max-width: 1024px) 50vw, 300px"
											style={{ objectFit: "cover" }}
											unoptimized
										/>
									</div>
								) : (
									<div
										style={{
											width: "100%",
											aspectRatio: "16/9",
											backgroundColor:
												"color-mix(in srgb, var(--color-primary) 10%, var(--color-navbar))",
										}}
									/>
								)}
								<div
									style={{
										padding: "1rem 1.1rem",
										flex: 1,
										display: "flex",
										flexDirection: "column",
									}}
								>
									<h3
										style={{
											margin: 0,
											fontSize: "1.05rem",
											color:
												"var(--color-navbar-text-readable, var(--color-navbar-text))",
											lineHeight: 1.4,
										}}
									>
										{a.title}
									</h3>
									<p
										className="muted"
										style={{
											margin: "0.35rem 0 0.6rem",
											fontSize: "0.78rem",
										}}
									>
										{formatDate(a.createdAt, "date", "")}
									</p>
									<p
										style={{
											margin: 0,
											color:
												"var(--color-navbar-text-readable, var(--color-navbar-text))",
											fontSize: "0.88rem",
											lineHeight: 1.55,
										}}
									>
										{excerpt(a.shortStory, 150)}
									</p>
								</div>
							</Link>
						))}
					</div>
				)}
			</ContentCard>
			{result && (
				<ContentCard>
					<nav
						aria-label={t("pagination")}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						{result.page > 1 ? (
							<Link href={href(result.page - 1)} className="btn">
								{t("previous")}
							</Link>
						) : (
							<span />
						)}
						<span>
							{t("pageSummary", {
								page: result.page,
								pages: result.lastPage,
								total: result.total,
							})}
						</span>
						{result.page < result.lastPage ? (
							<Link href={href(result.page + 1)} className="btn">
								{t("next")}
							</Link>
						) : (
							<span />
						)}
					</nav>
				</ContentCard>
			)}
		</section>
	);
}

export default withPublicPagePerformance("/news", NewsPage);
