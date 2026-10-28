import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteSetting } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { FaviconForm } from "./favicon-form";

export default async function AdminFaviconPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	let faviconUrl: string | null = null;
	try {
		const [setting] = await db
			.select({ value: WebsiteSetting.value })
			.from(WebsiteSetting)
			.where(eq(WebsiteSetting.key, "cms_favicon"))
			.limit(1);
		faviconUrl = setting?.value ?? null;
	} catch {
		faviconUrl = null;
	}

	return (
		<main>
			<FaviconForm currentUrl={faviconUrl} />
		</main>
	);
}
