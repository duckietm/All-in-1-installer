"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface QuestionResult {
	id: number;
	question: string;
	options: string;
	votes: string[]; // array of answer strings
}

interface Props {
	questions: QuestionResult[];
}

export function PollResultsView({ questions }: Props) {
	const t = useTranslations("pages.admin.polls");

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("resultsTitle")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-6">
				{questions.map((q) => {
					const options = q.options.split("\n").filter(Boolean);
					const totalVotes = q.votes.length;

					// Count votes per option
					const voteCounts = new Map<string, number>();
					for (const opt of options) voteCounts.set(opt, 0);
					for (const vote of q.votes) {
						voteCounts.set(vote, (voteCounts.get(vote) ?? 0) + 1);
					}

					return (
						<div key={q.id}>
							<h4 className="text-sm font-medium mb-3">{q.question}</h4>
							{options.length > 0 ? (
								<div className="space-y-2">
									{options.map((opt) => {
										const count = voteCounts.get(opt) ?? 0;
										const pct =
											totalVotes > 0
												? Math.round((count / totalVotes) * 100)
												: 0;
										return (
											<div key={opt}>
												<div className="flex justify-between text-xs mb-1">
													<span>{opt}</span>
													<span className="text-muted-foreground">
														{count} votes ({pct}%)
													</span>
												</div>
												<div className="h-2 w-full rounded-full bg-muted overflow-hidden">
													<div
														className="h-full rounded-full bg-primary transition-all"
														style={{ width: `${pct}%` }}
													/>
												</div>
											</div>
										);
									})}
								</div>
							) : (
								<div className="text-sm text-muted-foreground">
									{totalVotes} free-text responses
								</div>
							)}
							<p className="text-xs text-muted-foreground mt-2">
								{totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
							</p>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
