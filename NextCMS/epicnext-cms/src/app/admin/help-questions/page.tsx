import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { db, WebsiteHelpCenterCategories } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminHelpQuestions() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PAGES_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.helpCenter");
	let entries: (typeof WebsiteHelpCenterCategories.$inferSelect)[] = [];
	try {
		entries = await db
			.select()
			.from(WebsiteHelpCenterCategories)
			.orderBy(
				asc(WebsiteHelpCenterCategories.position),
				asc(WebsiteHelpCenterCategories.id),
			)
			.limit(500);
	} catch {
		entries = [];
	}

	const smallBoxes = entries.filter((e) => e.smallBox).length;
	const withButton = entries.filter((e) => e.buttonText).length;

	return (
		<main>
			<div className="flex justify-end mb-6">
				<Button variant="default" asChild>
					<Link href="/admin/help-questions/new">+ {t("newEntry")}</Link>
				</Button>
			</div>

			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("entries")} value={entries.length} icon="❓" />
				<StatusCard label={t("withButton")} value={withButton} icon="🔘" />
				<StatusCard label={t("smallBoxes")} value={smallBoxes} icon="🗂️" />
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">{t("entries")}</h2>
				{entries.length === 0 ? (
					<div className="admin-empty">{t("noEntries")}</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Pos.</th>
								<th>{t("colTitle")}</th>
								<th>Button</th>
								<th>Small box</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{entries.map((e) => (
								<tr key={String(e.id)}>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{e.position}
									</td>
									<td>
										<Link href={`/admin/help-questions/${e.id}`}>{e.name}</Link>
									</td>
									<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
										{e.buttonText || "—"}
									</td>
									<td>
										<span
											className={`inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${e.smallBox ? "bg-[var(--admin-success-subtle)] text-[var(--admin-text)]" : "bg-[var(--admin-accent)]/18 text-[var(--admin-text)]"}`}
										>
											{e.smallBox ? "Yes" : "No"}
										</span>
									</td>
									<td>
										<Link href={`/admin/help-questions/${e.id}`}>
											{t("edit")}
										</Link>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</main>
	);
}
