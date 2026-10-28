import { count, desc, like } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { fetchAdminList } from "@/lib/admin-list";
import { db, WebsitePoll } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { PollsTable } from "./polls-table";

export default async function PollsPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const t = await getTranslations("pages.admin.polls");
	const result = await fetchAdminList(
		{
			permission: PERMS.POLLS_VIEW,
			fetch: async ({ search, page, perPage }) => {
				const where = search
					? like(WebsitePoll.title, `%${search}%`)
					: undefined;
				const [rows, totals] = await Promise.all([
					db
						.select({
							id: WebsitePoll.id,
							title: WebsitePoll.title,
							status: WebsitePoll.status,
							showResults: WebsitePoll.showResults,
							multipleChoice: WebsitePoll.multipleChoice,
							startsAt: WebsitePoll.startsAt,
							endsAt: WebsitePoll.endsAt,
							createdAt: WebsitePoll.createdAt,
						})
						.from(WebsitePoll)
						.where(where)
						.orderBy(desc(WebsitePoll.createdAt))
						.limit(perPage)
						.offset((page - 1) * perPage),
					db.select({ total: count() }).from(WebsitePoll).where(where),
				]);
				return { rows, total: totals[0]?.total ?? 0 };
			},
		},
		paramsPromise,
		searchParams,
	);

	return (
		<div className="space-y-6">
			<div className="flex justify-end">
				<Button variant="default" asChild>
					<Link href="/admin/polls/create">{t("newPoll")}</Link>
				</Button>
			</div>

			<PollsTable
				data={{
					rows: result.rows,
					total: result.total,
					page: result.page,
					perPage: result.perPage,
					lastPage: result.lastPage,
				}}
			/>
		</div>
	);
}
