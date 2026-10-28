import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteTicketTemplate } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { TicketTemplatesManager } from "./templates-manager";

export default async function TicketTemplatesPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.TICKETS_EDIT, session.user.rank)) {
		redirect("/admin/tickets");
	}

	const templates = await db
		.select()
		.from(WebsiteTicketTemplate)
		.orderBy(asc(WebsiteTicketTemplate.sortOrder));

	return (
		<div className="space-y-6">
			<TicketTemplatesManager templates={templates} />
		</div>
	);
}
