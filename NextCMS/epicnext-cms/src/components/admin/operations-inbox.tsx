import { count, eq, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { collectOperations } from "@/lib/admin/operations-inbox";
import {
	db,
	WebsiteArticles,
	WebsiteHelpCenterTickets,
	WebsiteTicket,
} from "@/lib/db";
import { ErrorStore } from "@/lib/error-monitor";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { ImportJobStore } from "@/lib/services/furni-job-store";

export async function OperationsInbox() {
	const { session, permissions } = await getAdminContext();
	const allowed = (permission: string) =>
		canAccess(permissions, permission, session.user.rank);
	const t = await getTranslations("pages.admin.operations");
	const result = await collectOperations([
		{
			source: "errors",
			allowed: allowed(PERMS.DEVOPS_VIEW),
			load: async () => {
				const { records } = await new ErrorStore().read();
				const total = new Set(
					records
						.filter((record) => !record.resolved)
						.map((record) => record.fingerprint),
				).size;
				return [
					{
						id: "unresolved",
						source: "errors",
						count: total,
						severity: 3,
						href: "/admin/devops/cms-errors?status=open",
					},
				];
			},
		},
		{
			source: "imports",
			allowed: allowed(PERMS.ASSETS_IMPORT),
			load: async () => {
				const jobs = await new ImportJobStore().list({
					userId: Number(session.user.id),
					limit: 30,
				});
				const total = jobs.filter(
					(job) =>
						job.state === "interrupted" ||
						job.items.some((item) => item.state === "failed"),
				).length;
				return [
					{
						id: "attention",
						source: "imports",
						count: total,
						severity: 2,
						href: "/admin/operations",
					},
				];
			},
		},
		{
			source: "tickets",
			allowed: allowed(PERMS.TICKETS_VIEW),
			load: async () => {
				const [rows, helpRows] = await Promise.all([
					db
						.select({ total: count() })
						.from(WebsiteTicket)
						.where(ne(WebsiteTicket.status, "closed")),
					db
						.select({ total: count() })
						.from(WebsiteHelpCenterTickets)
						.where(eq(WebsiteHelpCenterTickets.open, true)),
				]);
				return [
					{
						id: "open",
						source: "tickets",
						count:
							Number(rows[0]?.total ?? 0) + Number(helpRows[0]?.total ?? 0),
						severity: 1,
						href: "/admin/tickets",
					},
				];
			},
		},
		{
			source: "publications",
			allowed: allowed(PERMS.NEWS_VIEW),
			load: async () => {
				const rows = await db
					.select({ total: count() })
					.from(WebsiteArticles)
					.where(eq(WebsiteArticles.status, "draft"));
				return [
					{
						id: "drafts",
						source: "publications",
						count: Number(rows[0]?.total ?? 0),
						severity: 0,
						href: "/admin/articles?status=draft",
					},
				];
			},
		},
	]);
	return (
		<section
			className="admin-card mb-6 space-y-3"
			aria-labelledby="operations-title"
		>
			<h2 id="operations-title" className="text-lg font-semibold">
				{t("title")}
			</h2>
			<p className="text-sm text-[var(--admin-text-muted)]">{t("hint")}</p>
			{result.items.length === 0 && result.unavailable.length === 0 ? (
				<p>{t("empty")}</p>
			) : null}
			<div className="grid gap-3 sm:grid-cols-2">
				{result.items.map((item) => (
					<Link
						key={`${item.source}:${item.id}`}
						href={item.href}
						className="rounded-lg border border-[var(--admin-border)] p-3 focus-visible:outline-2"
					>
						<span>{t(item.source)}</span>
						<strong className="float-right">{item.count}</strong>
					</Link>
				))}
			</div>
			{result.unavailable.map((source) => (
				<p
					key={source}
					role="status"
					className="text-sm text-[var(--admin-warning)]"
				>
					{t("unavailable", { source: t(source) })}
				</p>
			))}
			{allowed(PERMS.DEVOPS_VIEW) ? (
				<Link href="/admin/devops/installation" className="btn btn-outline">
					{t("installation")}
				</Link>
			) : null}
		</section>
	);
}
