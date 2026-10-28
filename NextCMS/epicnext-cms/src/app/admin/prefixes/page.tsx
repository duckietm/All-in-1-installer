import { redirect } from "next/navigation";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { PrefixesClient } from "./prefixes-client";

export default async function PrefixesPage() {
	const { session, permissions } = await getAdminContext();

	if (!canAccess(permissions, PERMS.PREFIXES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canEdit = canAccess(
		permissions,
		PERMS.PREFIXES_EDIT,
		session.user.rank,
	);

	return (
		<div className="space-y-6">
			<PrefixesClient canEdit={canEdit} />
		</div>
	);
}
