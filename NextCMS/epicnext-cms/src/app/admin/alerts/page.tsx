import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { markAllAlertsRead, sendHotelAlert } from "@/actions/admin-alerts";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { AlertLogs, db } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const CRITICAL = new Set(["critical", "error", "danger"]);
const WARNING = new Set(["warning", "warn"]);

function severityColor(severity: string): string {
	switch (severity.toLowerCase()) {
		case "critical":
		case "error":
		case "danger":
			return "var(--color-danger)";
		case "warning":
		case "warn":
			return "var(--admin-accent)";
		case "success":
			return "var(--color-secondary)";
		case "info":
		case "notice":
			return "var(--color-accent)";
		default:
			return "var(--admin-text-muted)";
	}
}

function Badge({ label, color }: { label: string; color: string }) {
	return (
		<span
			style={{
				display: "inline-block",
				padding: "0.1rem 0.55rem",
				borderRadius: "999px",
				background: color,
				color: "#fff",
				fontSize: "0.72rem",
				fontWeight: 700,
				letterSpacing: "0.02em",
				textTransform: "uppercase",
				whiteSpace: "nowrap",
			}}
		>
			{label}
		</span>
	);
}

export default async function AdminAlerts() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.NOTIFICATIONS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.alerts");

	let alerts: (typeof AlertLogs.$inferSelect)[] = [];
	try {
		alerts = await db
			.select()
			.from(AlertLogs)
			.orderBy(desc(AlertLogs.id))
			.limit(100);
	} catch {
		alerts = [];
	}

	const critical = alerts.filter((a) =>
		CRITICAL.has((a.severity || "").toLowerCase()),
	).length;
	const warnings = alerts.filter((a) =>
		WARNING.has((a.severity || "").toLowerCase()),
	).length;
	const unread = alerts.filter((a) => !a.isRead).length;

	return (
		<main>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
				<StatusCard label={t("alertsShown")} value={alerts.length} icon="🔔" />
				<StatusCard
					label={t("critical")}
					value={critical}
					state={critical > 0 ? "danger" : "ok"}
					icon="🚨"
				/>
				<StatusCard
					label={t("warnings")}
					value={warnings}
					state={warnings > 0 ? "warn" : "neutral"}
					icon="⚠️"
				/>
				<StatusCard
					label={t("unread")}
					value={unread}
					state={unread > 0 ? "warn" : "ok"}
					icon="📨"
				/>
			</div>

			<form action={sendHotelAlert} className="admin-card mb-6">
				<h3 className="mt-0">{t("form.send")}</h3>
				<p className="text-xs theme-text-muted dark:theme-text-muted">
					{t.rich("form.description", {
						code: (chunks) => <code>{chunks}</code>,
					})}
				</p>
				<div className="flex gap-2 flex-wrap items-start">
					<textarea
						name="message"
						required
						maxLength={1000}
						rows={2}
						placeholder={t("form.messagePlaceholder")}
						className="flex-1 min-w-[240px]"
					/>
					<Button type="submit" variant="default">
						{t("form.send")}
					</Button>
				</div>
			</form>

			<section className="admin-card">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h3 className="m-0">{t("recentAlerts", { count: alerts.length })}</h3>
					{unread > 0 ? (
						<form action={markAllAlertsRead}>
							<Button type="submit" variant="outline" size="sm">
								{t("markAllRead")}
							</Button>
						</form>
					) : null}
				</div>
				{alerts.length === 0 ? (
					<div className="admin-empty">{t("noAlerts")}</div>
				) : (
					<div className="overflow-x-auto">
						<table>
							<thead>
								<tr>
									<th>{t("colWhen")}</th>
									<th>{t("colSeverity")}</th>
									<th>{t("colType")}</th>
									<th>{t("colMessage")}</th>
								</tr>
							</thead>
							<tbody>
								{alerts.map((a) => (
									<tr key={String(a.id)}>
										<td className="text-sm theme-text-muted dark:theme-text-muted whitespace-nowrap">
											{formatDate(a.createdAt)}
										</td>
										<td>
											<Badge
												label={a.severity || "—"}
												color={severityColor(a.severity)}
											/>
										</td>
										<td>
											<Badge
												label={a.type || "—"}
												color="var(--admin-text-muted)"
											/>
										</td>
										<td>{a.message}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}
