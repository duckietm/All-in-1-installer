import { redirect } from "next/navigation";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { TranslationsTabs } from "./translations-tabs";

export default async function TranslationsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SETTINGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	return (
		<div className="space-y-6">
			<TranslationsTabs />
			{children}
		</div>
	);
}
