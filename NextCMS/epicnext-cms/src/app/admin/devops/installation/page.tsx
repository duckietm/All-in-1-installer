import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { inspectInstallation } from "@/lib/admin/installation";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { RefreshStatus } from "../../commandocentrum/refresh-status";
export default async function InstallationPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DEVOPS_VIEW, session.user.rank))
		redirect("/admin");
	const t = await getTranslations("pages.admin.installation");
	const result = await inspectInstallation();
	return (
		<div className="space-y-5">
			<h1 className="text-2xl font-semibold">{t("title")}</h1>
			<p>{t("hint")}</p>
			<p className="text-sm text-[var(--admin-text-muted)]">
				{t("checked", {
					time: formatDate(new Date(result.checkedAt), "datetime-seconds"),
					ms: result.durationMs,
				})}
			</p>
			<RefreshStatus label={t("recheck")} />
			<section className="admin-card space-y-3">
				<h2 className="font-semibold">{t("guideTitle")}</h2>
				<p>{t("guideHost")}</p>
				<code className="block break-all text-sm">bash cms install</code>
				<p>{t("guideAccess")}</p>
				<code className="block break-all text-sm">bash cms update</code>
				<p>{t("guidePinned")}</p>
				<p>{t("guideWorker")}</p>
				<p className="text-sm text-[var(--admin-text-muted)]">
					{t("guideRecovery")}
				</p>
			</section>
			<div className="grid gap-3 md:grid-cols-2">
				{result.rows.map((row) => (
					<section key={row.key} className="admin-card space-y-2 min-w-0">
						<h2 className="font-semibold">{t(row.key)}</h2>
						<p
							className={
								row.state === "failed"
									? "text-destructive"
									: row.state === "ok"
										? "text-[var(--admin-success)]"
										: "text-[var(--admin-text-muted)]"
							}
						>
							{t(row.state)}
						</p>
						{row.detail ? (
							<code className="block break-all text-xs">{row.detail}</code>
						) : null}
						<p className="text-sm text-[var(--admin-text-muted)]">
							{t(`${row.key}Hint`)}
						</p>
					</section>
				))}
			</div>
		</div>
	);
}
