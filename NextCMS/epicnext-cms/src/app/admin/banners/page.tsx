import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteBanner } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { BannersManager } from "./banners-manager";

export default async function BannersPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.BANNERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const banners = await db
		.select()
		.from(WebsiteBanner)
		.orderBy(asc(WebsiteBanner.sortOrder));

	return (
		<div className="space-y-6">
			<BannersManager banners={banners} />
		</div>
	);
}
