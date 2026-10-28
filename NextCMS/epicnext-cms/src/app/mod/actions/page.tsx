import { ModActionsClient } from "@/app/admin/moderation/actions/mod-actions-client";
import { requireModPermission } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";

export default async function ModQuickActionsPage() {
	await requireModPermission([PERMS.MOD_ACTIONS, PERMS.MODERATION_EDIT]);

	return (
		<div className="space-y-6">
			<ModActionsClient />
		</div>
	);
}
