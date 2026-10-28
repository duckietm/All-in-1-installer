import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteEventType } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { EventTypesManager } from "./event-types-manager";

export default async function EventTypesPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.EVENTS_EDIT, session.user.rank)) {
		redirect("/admin/events");
	}

	const eventTypes = await db
		.select()
		.from(WebsiteEventType)
		.orderBy(asc(WebsiteEventType.name));

	return (
		<div className="space-y-6">
			<EventTypesManager eventTypes={eventTypes} />
		</div>
	);
}
