import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, WebsitePoll } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { PollForm } from "../poll-form";
import { PollQuestionsManager } from "./poll-questions";
import { PollResultsView } from "./poll-results";

export default async function PollDetailPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.POLLS_EDIT, session.user.rank)) {
		redirect("/admin/polls");
	}

	const pollId = parseInt(id, 10);
	if (Number.isNaN(pollId)) notFound();

	const t = await getTranslations("pages.admin.polls");
	const tHubs = await getTranslations("pages.admin.hubs");

	const poll = await db.query.WebsitePoll.findFirst({
		where: eq(WebsitePoll.id, pollId),
		with: {
			questions: {
				orderBy: (q, { asc }) => [asc(q.sortOrder)],
				with: {
					votes: true,
				},
			},
		},
	});

	if (!poll) notFound();

	const totalVoters = new Set(
		poll.questions.flatMap((q) => q.votes.map((v) => v.userId)),
	).size;

	const statusLabel: Record<string, string> = {
		active: t("statusActive"),
		draft: t("statusDraft"),
		closed: t("statusClosed"),
	};

	return (
		<div className="space-y-6">
			<div>
				<AdminBreadcrumb
					items={[
						{ label: tHubs("tabs.polls"), href: "/admin/polls" },
						{ label: poll.title },
					]}
				/>
				<div className="flex items-center gap-3">
					<h1 className="m-0 text-2xl font-extrabold text-[var(--admin-text)]">
						{poll.title}
					</h1>
					<Badge
						variant={
							poll.status === "active"
								? "default"
								: poll.status === "closed"
									? "outline"
									: "secondary"
						}
					>
						{statusLabel[poll.status] ?? poll.status}
					</Badge>
				</div>
				{poll.description && (
					<p className="m-0 mt-1 text-sm text-[var(--admin-text-muted)]">
						{poll.description}
					</p>
				)}
			</div>

			{/* Stats */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statVoters")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{totalVoters}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statQuestions")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{poll.questions.length}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statVotes")}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{poll.questions.reduce((sum, q) => sum + q.votes.length, 0)}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Edit form */}
			<PollForm
				defaultValues={{
					id: poll.id,
					title: poll.title,
					description: poll.description,
					status: poll.status as "draft" | "active" | "closed",
					showResults: poll.showResults,
					multipleChoice: poll.multipleChoice,
					startsAt: poll.startsAt,
					endsAt: poll.endsAt,
				}}
			/>

			{/* Questions */}
			<PollQuestionsManager
				pollId={poll.id}
				questions={poll.questions.map((q) => ({
					id: q.id,
					question: q.question,
					type: q.type,
					sortOrder: q.sortOrder,
					options: q.options,
				}))}
			/>

			{/* Results */}
			{poll.questions.length > 0 && (
				<PollResultsView
					questions={poll.questions.map((q) => ({
						id: q.id,
						question: q.question,
						options: q.options,
						votes: q.votes.map((v) => v.answer),
					}))}
				/>
			)}
		</div>
	);
}
