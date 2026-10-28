import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { buyShopArticle } from "@/actions/shop";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { auth } from "@/lib/auth";
import { db, WebsiteShopArticles, WebsiteShopCategories } from "@/lib/db";
import { excerpt } from "@/lib/format";
import { creditsPerUnit } from "@/lib/services/paypal";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.shop");
	return {
		title: t("title"),
		description: t("subtitle"),
		openGraph: {
			title: t("title"),
			description: t("subtitle"),
			type: "website",
		},
	};
}

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

// Faithful to AtomCMS WebsiteShopArticle::price(): costs are stored in cents,
// the displayed price is costs/100 with a floor of 1.
function priceLabel(costs: number): string {
	const price = costs < 100 ? 1 : costs / 100;
	return `$${price.toFixed(2)}`;
}

function creditPriceLabel(costs: number): string {
	const rate = creditsPerUnit();
	const dollars = costs < 100 ? 1 : costs / 100;
	const credits = Math.max(1, Math.floor(dollars * rate));
	return credits.toLocaleString();
}

type ShopArticle = {
	id: bigint;
	name: string;
	info: string;
	iconUrl: string;
	color: string;
	costs: number;
	credits: number | null;
	duckets: number | null;
	diamonds: number | null;
	badges: string | null;
	position: number;
};

type ShopCategory = {
	id: bigint;
	name: string;
	icon: string | null;
};

const articleSelect = {
	id: WebsiteShopArticles.id,
	name: WebsiteShopArticles.name,
	info: WebsiteShopArticles.info,
	iconUrl: WebsiteShopArticles.iconUrl,
	color: WebsiteShopArticles.color,
	costs: WebsiteShopArticles.costs,
	credits: WebsiteShopArticles.credits,
	duckets: WebsiteShopArticles.duckets,
	diamonds: WebsiteShopArticles.diamonds,
	badges: WebsiteShopArticles.badges,
	position: WebsiteShopArticles.position,
} as const;

export default async function ShopPage({
	searchParams,
}: {
	searchParams: Promise<{
		category?: string;
		bought?: string;
		error?: string;
		package?: string;
	}>;
}) {
	const t = await getTranslations("pages.shop");
	const sp = await searchParams;
	const rawCategory = (sp.category ?? "").trim();
	const categoryId = /^\d+$/.test(rawCategory) ? rawCategory : "";

	const session = await auth();
	const isLoggedIn = Boolean(session?.user?.id);

	const errorMessage =
		sp.error === "invalid"
			? t("errors.invalid")
			: sp.error === "credits"
				? t("errors.credits")
				: sp.error === "online"
					? t("errors.online")
					: sp.error === "ratelimit"
						? t("errors.ratelimit")
						: sp.error
							? t("errors.error")
							: null;

	const boughtMessage =
		sp.bought === "1"
			? sp.package
				? t("success.boughtNamed", { name: sp.package })
				: t("success.bought")
			: null;

	// Categories for the filter bar and the article grid are independent —
	// fetch them concurrently.
	const [categories, articles] = await Promise.all([
		db
			.select({
				id: WebsiteShopCategories.id,
				name: WebsiteShopCategories.name,
				icon: WebsiteShopCategories.icon,
			})
			.from(WebsiteShopCategories)
			.orderBy(asc(WebsiteShopCategories.name))
			.catch((): ShopCategory[] => []),
		(categoryId
			? db
					.select(articleSelect)
					.from(WebsiteShopArticles)
					.where(eq(WebsiteShopArticles.categoryId, BigInt(categoryId)))
					.orderBy(asc(WebsiteShopArticles.position))
			: db
					.select(articleSelect)
					.from(WebsiteShopArticles)
					.orderBy(asc(WebsiteShopArticles.position))
		).catch((): ShopArticle[] => []),
	]);

	const activeCategory = categoryId
		? categories.find((c) => String(c.id) === categoryId)
		: undefined;

	return (
		<section className="page-grid">
			{boughtMessage ? (
				<div role="status" style={feedbackStyle("success")}>
					{boughtMessage}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
					{sp.error === "credits" ? (
						<>
							{" "}
							<Link href="/shop/topup">{t("topUpLink")}</Link>
						</>
					) : null}
				</div>
			) : null}

			<ContentCard
				icon="🛒"
				title={t("title")}
				subtitle={
					activeCategory
						? t("browsingCategory", { category: activeCategory.name })
						: t("subtitle")
				}
			>
				<p className="muted" style={{ margin: "0 0 0.75rem" }}>
					{t("creditsHint")} <Link href="/shop/topup">{t("topUpLink")}</Link>
				</p>
				{categories.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "0.5rem",
						}}
					>
						<Link
							href="/shop"
							className={`btn ${categoryId ? "btn-outline" : "btn-primary"}`}
						>
							{t("all")}
						</Link>
						{categories.map((c) => (
							<Link
								key={String(c.id)}
								href={`/shop?category=${String(c.id)}`}
								className={`btn ${categoryId === String(c.id) ? "btn-primary" : "btn-outline"}`}
							>
								{c.name}
							</Link>
						))}
					</div>
				) : null}
			</ContentCard>

			<ContentCard
				icon="📦"
				title={activeCategory ? activeCategory.name : t("allPackages")}
				subtitle={
					articles.length > 0
						? t("packagesAvailable", { count: articles.length })
						: undefined
				}
				padded={articles.length === 0}
			>
				{articles.length === 0 ? (
					<EmptyState icon="🛒">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{articles.map((a) => (
							<article key={String(a.id)} className="card hover">
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.75rem",
										marginBottom: "0.6rem",
									}}
								>
									<div
										style={{
											width: 56,
											height: 56,
											borderRadius: "var(--radius-sm)",
											display: "grid",
											placeItems: "center",
											background: "var(--color-background)",
											border: `2px solid ${a.color || "var(--border-color)"}`,
											flexShrink: 0,
											overflow: "hidden",
										}}
									>
										{a.iconUrl ? (
											<img
												src={a.iconUrl}
												alt=""
												width={48}
												height={48}
												style={{ objectFit: "contain", display: "block" }}
											/>
										) : null}
									</div>
									<div style={{ minWidth: 0 }}>
										<h3 style={{ margin: 0 }}>{a.name}</h3>
										<span className="muted">
											{t("priceCredits", {
												credits: creditPriceLabel(a.costs),
												usd: priceLabel(a.costs),
											})}
										</span>
									</div>
								</div>

								<p style={{ margin: "0 0 0.75rem" }}>{excerpt(a.info, 160)}</p>

								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										gap: "0.4rem",
										marginBottom: "0.85rem",
									}}
								>
									{a.credits ? (
										<span className="currency">
											<CurrencyIcon kind="credits" size={22} alt="" />
											{a.credits.toLocaleString()}
										</span>
									) : null}
									{a.duckets ? (
										<span className="currency">
											<CurrencyIcon kind="duckets" size={22} alt="" />
											{a.duckets.toLocaleString()}
										</span>
									) : null}
									{a.diamonds ? (
										<span className="currency">
											<CurrencyIcon kind="diamonds" size={22} alt="" />
											{a.diamonds.toLocaleString()}
										</span>
									) : null}
								</div>

								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: "0.5rem",
									}}
								>
									<span style={{ fontWeight: 800 }}>
										{t("priceCreditsShort", {
											credits: creditPriceLabel(a.costs),
										})}
									</span>
									{isLoggedIn ? (
										<form action={buyShopArticle} style={{ margin: 0 }}>
											<input
												type="hidden"
												name="articleId"
												value={String(a.id)}
											/>
											<input
												type="hidden"
												name="categoryId"
												value={categoryId}
											/>
											<button type="submit" className="btn btn-primary">
												{t("buy")}
											</button>
										</form>
									) : (
										<Link href="/login" className="btn btn-primary">
											{t("loginToBuy")}
										</Link>
									)}
								</div>
							</article>
						))}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
