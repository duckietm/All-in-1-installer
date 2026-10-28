import { redirect } from "next/navigation";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { ModActionsClient } from "./mod-actions-client";

export default async function QuickActionsPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.MODERATION_EDIT, session.user.rank))
		redirect("/admin");

	return (
		<div className="space-y-6">
			<ModActionsClient />
		</div>
	);
}
