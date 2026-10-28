import { redirect } from "next/navigation";
import { OperationsCenter } from "@/components/admin/operations-center";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
export default async function OperationsPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank))
		redirect("/admin");
	return <OperationsCenter />;
}
