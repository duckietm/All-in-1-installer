import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
export async function generateMetadata() {
	const t = await getTranslations("pages.notifications");
	return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function NotificationsPage() {
	const uid = sessionUserId((await auth())?.user?.id);
	if (!uid) redirect("/login");
	return <NotificationCenter userId={uid} />;
}
