import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import {
	db,
	WebsitePoll,
	WebsitePollQuestion,
	WebsitePollVote,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PollVoteForm } from "./poll-vote-form";

export default async function PollDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const pollId = Number.parseInt(id, 10);
	if (!Number.isFinite(pollId) || pollId <= 0) notFound();

	const t = await getTranslations("pages.polls");
	const session = await auth();
	const userId = Number(session?.user?.id);

	const [poll] = await db
		.select()
		.from(WebsitePoll)
		.where(eq(WebsitePoll.id, pollId))
		.limit(1)
		.catch(() => []);

	if (!poll || (poll.status !== "active" && poll.status !== "closed")) {
		notFound();
	}

	const questions = await db
		.select()
		.from(WebsitePollQuestion)
		.where(eq(WebsitePollQuestion.pollId, poll.id))
		.orderBy(asc(WebsitePollQuestion.sortOrder))
		.catch(() => []);

	const now = Date.now();
	if (
		poll.startsAt &&
		poll.startsAt.getTime() > now &&
		poll.status === "active"
	) {
		// Not started yet — treat as unavailable for guests
		notFound();
	}

	const hasEnded =
		poll.status === "closed" ||
		(poll.endsAt != null && poll.endsAt.getTime() < now);
	const isOpen = poll.status === "active" && !hasEnded;

	const questionIds = questions.map((q) => q.id);

	// My votes and the aggregate results are independent — load them together.
	const [myVotes, allVotes] = await Promise.all([
		Number.isInteger(userId) && userId > 0 && questionIds.length > 0
			? db
					.select()
					.from(WebsitePollVote)
					.where(
						and(
							eq(WebsitePollVote.userId, userId),
							inArray(WebsitePollVote.questionId, questionIds),
						),
					)
					.catch(() => [])
			: Promise.resolve([]),
		poll.showResults === 1 && questionIds.length > 0
			? db
					.select({
						questionId: WebsitePollVote.questionId,
						answer: WebsitePollVote.answer,
					})
					.from(WebsitePollVote)
					.where(inArray(WebsitePollVote.questionId, questionIds))
					.catch(() => [])
			: Promise.resolve([]),
	]);
	const hasVoted = myVotes.length > 0;

	const votesByQuestion = new Map<number, string[]>();
	for (const vote of allVotes) {
		const list = votesByQuestion.get(vote.questionId) ?? [];
		list.push(vote.answer);
		votesByQuestion.set(vote.questionId, list);
	}

	return (
		<section className="page-grid">
			<p className="muted" style={{ margin: 0 }}>
				<Link href="/polls">{t("back")}</Link>
			</p>

			<ContentCard
				icon="📊"
				title={poll.title}
				subtitle={
					hasEnded
						? t("statusClosed")
						: t("statusActive") +
							(poll.endsAt
								? ` · ${t("ends", { date: formatDate(poll.endsAt, "datetime", "") })}`
								: "")
				}
			>
				{poll.description ? (
					<p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
						{poll.description}
					</p>
				) : null}
			</ContentCard>

			{isOpen && !hasVoted ? (
				session?.user ? (
					<ContentCard
						icon="🗳️"
						title={t("voteTitle")}
						subtitle={t("voteSubtitle")}
					>
						<PollVoteForm
							pollId={poll.id}
							questions={questions.map((q) => ({
								id: q.id,
								question: q.question,
								type: q.type,
								options: q.options,
							}))}
						/>
					</ContentCard>
				) : (
					<ContentCard padded>
						<EmptyState icon="🔒">{t("loginToVote")}</EmptyState>
					</ContentCard>
				)
			) : (
				<ContentCard padded>
					<EmptyState icon={hasVoted ? "✅" : "ℹ️"}>
						{hasVoted
							? t("alreadyVoted")
							: hasEnded
								? t("pollClosed")
								: t("cannotVote")}
					</EmptyState>
				</ContentCard>
			)}

			{poll.showResults === 1 && (hasVoted || hasEnded) ? (
				<ContentCard icon="📈" title={t("resultsTitle")}>
					<div style={{ display: "grid", gap: "1.25rem" }}>
						{questions.map((q) => {
							const options = q.options
								.split("\n")
								.map((o) => o.trim())
								.filter(Boolean);
							const votes = votesByQuestion.get(q.id) ?? [];
							const total = votes.length;

							if (q.type === "text" || options.length === 0) {
								return (
									<div key={q.id}>
										<h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>
											{q.question}
										</h3>
										<p className="muted" style={{ margin: 0 }}>
											{t("textResponses", { count: total })}
										</p>
									</div>
								);
							}

							const counts = new Map<string, number>();
							for (const opt of options) counts.set(opt, 0);
							for (const vote of votes) {
								for (const part of vote
									.split("\n")
									.map((a) => a.trim())
									.filter(Boolean)) {
									counts.set(part, (counts.get(part) ?? 0) + 1);
								}
							}

							return (
								<div key={q.id}>
									<h3 style={{ margin: "0 0 0.65rem", fontSize: "1rem" }}>
										{q.question}
									</h3>
									<div style={{ display: "grid", gap: "0.55rem" }}>
										{options.map((opt) => {
											const voteCount = counts.get(opt) ?? 0;
											const pct =
												total > 0 ? Math.round((voteCount / total) * 100) : 0;
											return (
												<div key={opt}>
													<div
														style={{
															display: "flex",
															justifyContent: "space-between",
															fontSize: "0.85rem",
															marginBottom: "0.2rem",
														}}
													>
														<span>{opt}</span>
														<span className="muted">
															{t("voteCount", { count: voteCount, pct })}
														</span>
													</div>
													<div
														style={{
															height: 8,
															borderRadius: 999,
															background:
																"color-mix(in srgb, var(--color-text-muted) 16%, transparent)",
															overflow: "hidden",
														}}
													>
														<div
															style={{
																height: "100%",
																width: `${pct}%`,
																borderRadius: 999,
																background: "var(--color-primary)",
															}}
														/>
													</div>
												</div>
											);
										})}
									</div>
									<p
										className="muted"
										style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}
									>
										{t("totalVotes", { count: total })}
									</p>
								</div>
							);
						})}
					</div>
				</ContentCard>
			) : null}
		</section>
	);
}
