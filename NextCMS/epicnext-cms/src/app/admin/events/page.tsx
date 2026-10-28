import { count, desc, eq, like } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { fetchAdminList } from "@/lib/admin-list";
import { db, WebsiteEvent, WebsiteEventType } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { EventsTable } from "./events-table";

export default async function EventsPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const t = await getTranslations("pages.admin.events");
	const result = await fetchAdminList(
		{
			permission: PERMS.EVENTS_VIEW,
			fetch: async ({ search, page, perPage }) => {
				const [rows, totals] = await Promise.all([
					db
						.select({
							id: WebsiteEvent.id,
							title: WebsiteEvent.title,
							startsAt: WebsiteEvent.startsAt,
							endsAt: WebsiteEvent.endsAt,
							status: WebsiteEvent.status,
							hostUserId: WebsiteEvent.hostUserId,
							typeName: WebsiteEventType.name,
							typeColor: WebsiteEventType.color,
						})
						.from(WebsiteEvent)
						.leftJoin(
							WebsiteEventType,
							eq(WebsiteEvent.typeId, WebsiteEventType.id),
						)
						.where(search ? like(WebsiteEvent.title, `%${search}%`) : undefined)
						.orderBy(desc(WebsiteEvent.startsAt))
						.limit(perPage)
						.offset((page - 1) * perPage),
					db.select({ total: count() }).from(WebsiteEvent),
				]);
				return {
					rows: rows.map((e) => ({
						id: e.id,
						title: e.title,
						typeName: e.typeName ?? "",
						typeColor: e.typeColor ?? "",
						startsAt: e.startsAt,
						endsAt: e.endsAt,
						status: e.status,
						hostUserId: e.hostUserId,
					})),
					total: totals[0]?.total ?? 0,
				};
			},
		},
		paramsPromise,
		searchParams,
	);

	return (
		<div className="space-y-6">
			<div className="flex justify-end">
				<Button variant="default" asChild>
					<Link href="/admin/events/create">{t("newEvent")}</Link>
				</Button>
			</div>

			<EventsTable
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
