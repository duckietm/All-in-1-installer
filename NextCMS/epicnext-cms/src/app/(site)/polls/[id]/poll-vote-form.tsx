"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { voteOnPoll } from "@/actions/polls";
import { useServerAction } from "@/hooks/use-server-action";

interface Question {
	id: number;
	question: string;
	type: string;
	options: string;
}

function parseOptions(options: string): string[] {
	return options
		.split("\n")
		.map((o) => o.trim())
		.filter(Boolean);
}

export function PollVoteForm({
	pollId,
	questions,
}: {
	pollId: number;
	questions: Question[];
}) {
	const t = useTranslations("pages.polls");
	const { run, isPending } = useServerAction();
	const [answers, setAnswers] = useState<Record<number, string>>({});
	const [multi, setMulti] = useState<Record<number, string[]>>({});

	function setSingle(questionId: number, value: string) {
		setAnswers((prev) => ({ ...prev, [questionId]: value }));
	}

	function toggleMulti(questionId: number, option: string) {
		setMulti((prev) => {
			const current = prev[questionId] ?? [];
			const next = current.includes(option)
				? current.filter((o) => o !== option)
				: [...current, option];
			return { ...prev, [questionId]: next };
		});
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const votes = questions.map((q) => {
			if (q.type === "multiple") {
				return {
					questionId: q.id,
					answer: (multi[q.id] ?? []).join("\n"),
				};
			}
			return {
				questionId: q.id,
				answer: (answers[q.id] ?? "").trim(),
			};
		});

		if (votes.some((v) => !v.answer)) {
			toast.error(t("voteError"));
			return;
		}

		run(() => voteOnPoll({ pollId, votes }), {
			successMessage: t("voteSuccess"),
			errorMessage: t("voteError"),
			// voteOnPoll revalidates /polls and /polls/<id>.
			revalidated: true,
		});
	}

	return (
		<form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.25rem" }}>
			{questions.map((q) => {
				const options = parseOptions(q.options);
				return (
					<fieldset
						key={q.id}
						style={{
							margin: 0,
							padding: "0.85rem 1rem",
							border:
								"1px solid color-mix(in srgb, var(--color-text-muted) 18%, transparent)",
							borderRadius: "0.65rem",
						}}
					>
						<legend style={{ padding: "0 0.35rem", fontWeight: 700 }}>
							{q.question}
						</legend>

						{q.type === "text" ? (
							<textarea
								required
								maxLength={500}
								rows={3}
								value={answers[q.id] ?? ""}
								onChange={(e) => setSingle(q.id, e.target.value)}
								placeholder={t("textPlaceholder")}
								style={{
									width: "100%",
									marginTop: "0.35rem",
									resize: "vertical",
								}}
							/>
						) : q.type === "multiple" ? (
							<div
								style={{ display: "grid", gap: "0.4rem", marginTop: "0.35rem" }}
							>
								{options.map((opt) => (
									<label
										key={opt}
										style={{
											display: "flex",
											gap: "0.5rem",
											alignItems: "center",
											cursor: "pointer",
										}}
									>
										<input
											type="checkbox"
											checked={(multi[q.id] ?? []).includes(opt)}
											onChange={() => toggleMulti(q.id, opt)}
										/>
										<span>{opt}</span>
									</label>
								))}
							</div>
						) : (
							<div
								style={{ display: "grid", gap: "0.4rem", marginTop: "0.35rem" }}
							>
								{options.map((opt) => (
									<label
										key={opt}
										style={{
											display: "flex",
											gap: "0.5rem",
											alignItems: "center",
											cursor: "pointer",
										}}
									>
										<input
											type="radio"
											name={`q-${q.id}`}
											required
											checked={(answers[q.id] ?? "") === opt}
											onChange={() => setSingle(q.id, opt)}
										/>
										<span>{opt}</span>
									</label>
								))}
							</div>
						)}
					</fieldset>
				);
			})}

			<button type="submit" className="btn btn-primary" disabled={isPending}>
				{isPending ? t("voting") : t("submitVote")}
			</button>
		</form>
	);
}
