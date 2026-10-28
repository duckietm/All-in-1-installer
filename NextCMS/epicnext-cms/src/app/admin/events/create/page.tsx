import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, WebsiteEventType } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { EventForm } from "../event-form";

export default async function CreateEventPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.EVENTS_EDIT, session.user.rank)) {
		redirect("/admin/events");
	}

	const t = await getTranslations("pages.admin.events");
	const eventTypes = await db
		.select()
		.from(WebsiteEventType)
		.where(eq(WebsiteEventType.isActive, 1))
		.orderBy(asc(WebsiteEventType.name));

	return (
		<div className="space-y-6">
			<div>
				<h1 className="m-0 text-2xl font-extrabold text-[var(--admin-text)]">
					{t("createTitle")}
				</h1>
				<p className="m-0 mt-1 text-sm text-[var(--admin-text-muted)]">
					{t("createSubtitle")}
				</p>
			</div>

			<EventForm userId={String(session.user.id)} eventTypes={eventTypes} />
		</div>
	);
}
