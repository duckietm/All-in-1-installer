import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { StudioLayoutClient } from "./studio-layout-client";

export default async function StudioLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { session, permissions } = await getAdminContext();
	const canEditCatalog = canAccess(
		permissions,
		PERMS.CATALOG_EDIT,
		session.user.rank,
	);

	return (
		<StudioLayoutClient canEditCatalog={canEditCatalog}>
			{children}
		</StudioLayoutClient>
	);
}
