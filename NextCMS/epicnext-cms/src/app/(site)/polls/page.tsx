import { and, count, desc, inArray, isNull, lte, or } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { db, WebsitePoll, WebsitePollQuestion } from "@/lib/db";
import { excerpt } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("pages.polls");
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

export default async function PollsPage() {
	const t = await getTranslations("pages.polls");
	const now = new Date();

	const pollRows = await db
		.select()
		.from(WebsitePoll)
		.where(
			and(
				inArray(WebsitePoll.status, ["active", "closed"]),
				or(isNull(WebsitePoll.startsAt), lte(WebsitePoll.startsAt, now)),
			),
		)
		.orderBy(desc(WebsitePoll.createdAt))
		.limit(50)
		.catch(() => []);

	const pollIds = pollRows.map((p) => p.id);
	const questionCounts =
		pollIds.length > 0
			? await db
					.select({
						pollId: WebsitePollQuestion.pollId,
						value: count(),
					})
					.from(WebsitePollQuestion)
					.where(inArray(WebsitePollQuestion.pollId, pollIds))
					.groupBy(WebsitePollQuestion.pollId)
					.catch(() => [])
			: [];
	const countByPoll = new Map(
		questionCounts.map((r) => [r.pollId, Number(r.value)]),
	);

	const polls = pollRows.map((poll) => ({
		...poll,
		_count: { questions: countByPoll.get(poll.id) ?? 0 },
	}));

	return (
		<section className="page-grid">
			<ContentCard icon="📊" title={t("title")} subtitle={t("subtitle")} />

			<ContentCard padded={polls.length === 0}>
				{polls.length === 0 ? (
					<EmptyState icon="📊">{t("empty")}</EmptyState>
				) : (
					<div className="card-grid sm-2 lg-3" style={{ padding: "1rem" }}>
						{polls.map((poll) => {
							const ended =
								poll.status === "closed" ||
								(poll.endsAt != null && poll.endsAt.getTime() < Date.now());
							return (
								<Link
									key={poll.id}
									href={`/polls/${poll.id}`}
									className="card hover"
									style={{
										color: "inherit",
										textDecoration: "none",
										display: "grid",
										gap: "0.35rem",
									}}
								>
									<p
										className="muted"
										style={{ margin: 0, fontSize: "0.75rem" }}
									>
										{ended ? t("statusClosed") : t("statusActive")}
										{" · "}
										{t("questionsCount", { count: poll._count.questions })}
									</p>
									<h3 style={{ margin: 0, fontSize: "1.05rem" }}>
										{poll.title}
									</h3>
									{poll.description ? (
										<p
											style={{
												margin: 0,
												fontSize: "0.88rem",
												lineHeight: 1.5,
											}}
										>
											{excerpt(poll.description, 120)}
										</p>
									) : null}
									<p
										className="muted"
										style={{ margin: 0, fontSize: "0.85rem" }}
									>
										{poll.endsAt
											? t("ends", {
													date: formatDate(poll.endsAt, "datetime", ""),
												})
											: formatDate(poll.createdAt, "date", "")}
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
