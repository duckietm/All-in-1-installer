import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, RadioGiveaways } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export default async function RadioGiveawaysPage() {
	const t = await getTranslations("pages.radioGiveaways");

	const giveaways = await db
		.select({
			id: RadioGiveaways.id,
			title: RadioGiveaways.title,
			prize: RadioGiveaways.prize,
			prizeAmount: RadioGiveaways.prizeAmount,
			prizeCurrency: RadioGiveaways.prizeCurrency,
			startDate: RadioGiveaways.startDate,
			endDate: RadioGiveaways.endDate,
		})
		.from(RadioGiveaways)
		.where(eq(RadioGiveaways.isActive, true))
		.orderBy(desc(RadioGiveaways.startDate))
		.limit(50)
		.catch(() => []);

	return (
		<section className="page-grid">
			<ContentCard icon="🎁" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={giveaways.length === 0}>
				{giveaways.length === 0 ? (
					<EmptyState icon="🎁">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{giveaways.map((g) => {
							const id = g.id.toString();
							const prizeStr =
								g.prize ||
								(g.prizeAmount > 0
									? `${g.prizeAmount} ${g.prizeCurrency || "credits"}`
									: null);
							return (
								<Link
									key={id}
									href={`/radio/giveaways/${id}`}
									className="card hover"
									style={{
										color: "inherit",
										textDecoration: "none",
										display: "grid",
										gap: "0.3rem",
									}}
								>
									<h3 style={{ margin: 0, fontSize: "1rem" }}>
										<span aria-hidden>🎁</span>{" "}
										{g.title || t("giveawayLabel", { id })}
									</h3>
									{prizeStr ? (
										<p
											className="muted"
											style={{ margin: 0, fontSize: "0.9rem" }}
										>
											Prize: {prizeStr}
										</p>
									) : null}
									<p
										className="muted"
										style={{ margin: 0, fontSize: "0.85rem" }}
									>
										{g.startDate
											? `${formatDate(g.startDate, "date", "")} — ${g.endDate ? formatDate(g.endDate, "date", "") : "ongoing"}`
											: t("dateUnknown")}
									</p>
								</Link>
							);
						})}
					</div>
				)}
			</ContentCard>
		</section>
	);
}
