import { asc } from "drizzle-orm";
import { Filter } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { db, WebsiteWordfilter } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { WordFilterClient } from "./wordfilter-client";

export default async function AdminWordFilter() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.WORDFILTER_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.wordfilter");
	const canEdit = canAccess(
		permissions,
		PERMS.WORDFILTER_EDIT,
		session.user.rank,
	);

	let words: { id: string; word: string }[] = [];
	try {
		const rows = await db
			.select({ id: WebsiteWordfilter.id, word: WebsiteWordfilter.word })
			.from(WebsiteWordfilter)
			.orderBy(asc(WebsiteWordfilter.word))
			.limit(500);
		words = rows.map((w) => ({ id: String(w.id), word: w.word }));
	} catch {
		words = [];
	}

	return (
		<AdminPageShell icon={Filter} title={t("title")} subtitle={t("subtitle")}>
			<WordFilterClient words={words} canEdit={canEdit} />
		</AdminPageShell>
	);
}
