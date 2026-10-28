import { redirect } from "next/navigation";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function RadioAdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.RADIO_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	return children;
}
