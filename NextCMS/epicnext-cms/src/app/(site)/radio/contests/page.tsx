import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, RadioContests } from "@/lib/db";
import { formatDate } from "@/lib/format-date";

export default async function RadioContestsPage() {
	const t = await getTranslations("pages.radioContests");

	const contests = await db
		.select({
			id: RadioContests.id,
			title: RadioContests.title,
			prize: RadioContests.prize,
			startDate: RadioContests.startDate,
			endDate: RadioContests.endDate,
		})
		.from(RadioContests)
		.where(eq(RadioContests.isActive, true))
		.orderBy(desc(RadioContests.startDate))
		.limit(50)
		.catch(() => []);

	return (
		<section className="page-grid">
			<ContentCard icon="🎉" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={contests.length === 0}>
				{contests.length === 0 ? (
					<EmptyState icon="🎉">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{contests.map((c) => {
							const id = c.id.toString();
							return (
								<Link
									key={id}
									href={`/radio/contests/${id}`}
									className="card hover"
									style={{
										color: "inherit",
										textDecoration: "none",
										display: "grid",
										gap: "0.3rem",
									}}
								>
									<h3 style={{ margin: 0, fontSize: "1rem" }}>
										<span aria-hidden>🎉</span>{" "}
										{c.title || t("contestLabel", { id })}
									</h3>
									{c.prize ? (
										<p
											className="muted"
											style={{ margin: 0, fontSize: "0.9rem" }}
										>
											Prize: {c.prize}
										</p>
									) : null}
									<p
										className="muted"
										style={{ margin: 0, fontSize: "0.85rem" }}
									>
										{c.startDate
											? `${formatDate(c.startDate, "date", "")} — ${c.endDate ? formatDate(c.endDate, "date", "") : "ongoing"}`
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
