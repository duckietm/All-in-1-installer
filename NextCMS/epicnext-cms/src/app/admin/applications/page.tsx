import { desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ApplicationActions } from "@/components/admin/application-actions";
import { StatusCard } from "@/components/admin/dashboard";
import Link from "@/components/link";

import { db, User, WebsiteStaffApplications } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";

type ApplicationRow = {
	id: bigint;
	userId: number;
	rankId: number;
	content: string;
	createdAt: Date | null;
};

export default async function AdminApplications() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.USERS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.applications");
	let applications: ApplicationRow[];
	try {
		applications = await db
			.select()
			.from(WebsiteStaffApplications)
			.orderBy(desc(WebsiteStaffApplications.createdAt))
			.limit(100);
	} catch (error) {
		logServerError("applications.query_failed", error);
		applications = [];
	}

	// Resolve applicant usernames (no relation defined on the model).
	const userMap = new Map<number, string>();
	if (applications.length > 0) {
		try {
			const ids = Array.from(new Set(applications.map((a) => a.userId)));
			const users = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, ids));
			for (const u of users) userMap.set(u.id, u.username);
		} catch (error) {
			logServerError("applications.user_lookup_failed", error);
		}
	}

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard
					label={t("pending")}
					value={applications.length}
					state={applications.length > 0 ? "warn" : "ok"}
					icon="📨"
				/>
			</div>

			<section className="mt-6">
				<h2 className="admin-section-title">
					{t("applicationsTitle", { count: applications.length })}
				</h2>
				{applications.length === 0 ? (
					<div className="admin-empty">{t("noApplications")}</div>
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{applications.map((a) => {
							const username = userMap.get(a.userId);
							return (
								<article key={String(a.id)} className="admin-card p-3">
									<div className="flex items-baseline justify-between gap-2 mb-1">
										<h3 className="m-0 text-sm font-semibold text-[var(--admin-text)]">
											{username ? (
												<Link href={`/admin/users/${a.userId}`}>
													{username}
												</Link>
											) : (
												t("userNumber", { id: a.userId })
											)}
										</h3>
										<span className="inline-block text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[var(--admin-accent)]/18 text-[var(--admin-text)]">
											{t("rankLabel", { rank: a.rankId })}
										</span>
									</div>
									<p className="text-xs theme-text-muted dark:theme-text-muted m-0 mb-2">
										{formatDate(a.createdAt, "datetime", "—")}
									</p>
									<p className="text-sm text-[var(--admin-text)] whitespace-pre-wrap m-0 mb-3">
										{a.content}
									</p>
									<ApplicationActions id={String(a.id)} />
								</article>
							);
						})}
					</div>
				)}
			</section>
		</main>
	);
}
