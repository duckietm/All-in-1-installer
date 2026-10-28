import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";

type RareRow = {
	id: bigint;
	name: string;
	creditValue: string | null;
	currencyValue: string | null;
	currencyType: string;
	furnitureIcon: string;
	itemId: number | null;
};

type CurrencyTranslator = (key: string) => string;

function prettyCurrency(type: string, t: CurrencyTranslator): string {
	switch (type) {
		case "0":
		case "duckets":
			return t("duckets");
		case "5":
		case "diamonds":
			return t("diamonds");
		case "-1":
		case "credits":
			return t("credits");
		default:
			return type.charAt(0).toUpperCase() + type.slice(1);
	}
}

export default async function RareCategoryPage({
	params,
}: {
	params: Promise<{ category: string }>;
}) {
	const t = await getTranslations("pages.rareCategory");
	const { category } = await params;

	let categoryId: bigint;
	try {
		categoryId = BigInt(category);
	} catch {
		notFound();
	}

	let cat: { id: bigint; name: string; badge: string } | null = null;
	try {
		const [row] = await db
			.select({
				id: WebsiteRareValueCategories.id,
				name: WebsiteRareValueCategories.name,
				badge: WebsiteRareValueCategories.badge,
			})
			.from(WebsiteRareValueCategories)
			.where(eq(WebsiteRareValueCategories.id, categoryId))
			.limit(1);
		cat = row ?? null;
	} catch {
		cat = null;
	}

	if (!cat) notFound();

	let rares: RareRow[] = [];
	try {
		rares = await db
			.select({
				id: WebsiteRareValues.id,
				name: WebsiteRareValues.name,
				creditValue: WebsiteRareValues.creditValue,
				currencyValue: WebsiteRareValues.currencyValue,
				currencyType: WebsiteRareValues.currencyType,
				furnitureIcon: WebsiteRareValues.furnitureIcon,
				itemId: WebsiteRareValues.itemId,
			})
			.from(WebsiteRareValues)
			.where(eq(WebsiteRareValues.categoryId, categoryId))
			.orderBy(asc(WebsiteRareValues.name));
	} catch {
		rares = [];
	}

	const [iconsBase, badgesBase] = await Promise.all([
		siteSettings.get("furniture_icons_path", ""),
		siteSettings.get("badges_path", ""),
	]);
	const iconBase = iconsBase ?? "";
	const badgeBase = badgesBase ?? "";
	const badgeSrc =
		badgeBase && cat.badge ? `${badgeBase}/${cat.badge}.gif` : "";

	return (
		<section className="page-grid">
			<ContentCard
				icon={badgeSrc ? undefined : "💎"}
				title={
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: "0.6rem",
						}}
					>
						{badgeSrc ? (
							<img
								src={badgeSrc}
								alt={`${cat.name} badge`}
								width={32}
								height={32}
							/>
						) : null}
						{cat.name}
					</span>
				}
				subtitle={t("rareCount", { count: rares.length })}
				action={
					<Link className="btn btn-outline" href="/rares">
						{t("allRares")}
					</Link>
				}
				padded={rares.length === 0}
			>
				{rares.length === 0 ? (
					<EmptyState icon="💎">{t("empty")}</EmptyState>
				) : (
					<div style={{ padding: "0.25rem 1rem 0.75rem", overflowX: "auto" }}>
						<table>
							<thead>
								<tr>
									<th style={{ width: 56 }}></th>
									<th>{t("colRare")}</th>
									<th>{t("colCredits")}</th>
									<th>{t("colCurrency")}</th>
								</tr>
							</thead>
							<tbody>
								{rares.map((r) => {
									const iconSrc =
										iconBase && r.furnitureIcon
											? `${iconBase}/${r.furnitureIcon}`
											: "";
									return (
										<tr key={String(r.id)}>
											<td>
												{iconSrc ? (
													<img
														src={iconSrc}
														alt=""
														width={40}
														height={40}
														style={{ objectFit: "contain" }}
													/>
												) : (
													<span
														className="avatar"
														style={{
															display: "inline-block",
															width: 40,
															height: 40,
														}}
													/>
												)}
											</td>
											<td>
												<strong>{r.name}</strong>
											</td>
											<td>
												{r.creditValue && r.creditValue !== "" ? (
													t("creditsValue", { value: r.creditValue })
												) : (
													<span className="muted">—</span>
												)}
											</td>
											<td>
												{r.currencyValue && r.currencyValue !== "" ? (
													`${r.currencyValue} ${prettyCurrency(r.currencyType, t)}`
												) : (
													<span className="muted">—</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</ContentCard>
		</section>
	);
}
