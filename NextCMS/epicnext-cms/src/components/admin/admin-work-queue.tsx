import { count, eq, ne } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { db, WebsiteHelpCenterTickets, WebsiteTicket } from "@/lib/db";
import { ErrorStore } from "@/lib/error-monitor";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import { ImportJobStore } from "@/lib/services/furni-job-store";

export async function AdminWorkQueue() {
	const [{ session, permissions }, t] = await Promise.all([
		getAdminContext(),
		getTranslations("pages.admin.workQueue"),
	]);
	const allowed = (permission: string) =>
		canAccess(permissions, permission, session.user.rank);
	const entries: { key: string; href: string; load: () => Promise<number> }[] =
		[];
	if (allowed(PERMS.TICKETS_VIEW))
		entries.push({
			key: "tickets",
			href: "/admin/tickets",
			load: async () => {
				const [cms, help] = await Promise.all([
					db
						.select({ total: count() })
						.from(WebsiteTicket)
						.where(ne(WebsiteTicket.status, "closed")),
					db
						.select({ total: count() })
						.from(WebsiteHelpCenterTickets)
						.where(eq(WebsiteHelpCenterTickets.open, true)),
				]);
				return (cms[0]?.total ?? 0) + (help[0]?.total ?? 0);
			},
		});
	if (allowed(PERMS.ASSETS_IMPORT))
		entries.push({
			key: "imports",
			href: "/admin/studio/furni",
			load: async () =>
				(await new ImportJobStore().list()).filter(
					(job) =>
						job.userId === Number(session.user.id) &&
						(job.state === "interrupted" ||
							job.items.some((item) => item.state === "failed")),
				).length,
		});
	if (allowed(PERMS.DEVOPS_VIEW))
		entries.push({
			key: "errors",
			href: "/admin/devops/cms-errors?status=open",
			load: async () =>
				new Set(
					(await new ErrorStore().read()).records
						.filter((record) => !record.resolved)
						.map((record) => record.fingerprint),
				).size,
		});
	const cards = await Promise.all(
		entries.map(async (entry) => {
			try {
				return { ...entry, count: await entry.load() };
			} catch (error) {
				logServerError("admin.work_queue_failed", error, { queue: entry.key });
				return { ...entry, count: null };
			}
		}),
	);
	if (!cards.length) return null;
	return (
		<section className="mb-6" aria-labelledby="work-queue">
			<h2
				id="work-queue"
				className="mb-3 text-sm font-bold text-[var(--admin-text)]"
			>
				{t("title")}
			</h2>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{cards.map((card) => (
					<Link
						href={card.href}
						key={card.key}
						className="admin-card flex items-center gap-4 no-underline focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
					>
						<span className="text-2xl font-bold tabular-nums text-[var(--admin-text)]">
							{card.count ?? "—"}
						</span>
						<span className="min-w-0 flex-1">
							<strong className="block text-sm text-[var(--admin-text)]">
								{t(card.key)}
							</strong>
							<span className="text-xs text-[var(--admin-text-muted)]">
								{card.count === null ? t("unavailable") : t(`${card.key}Hint`)}
							</span>
						</span>
						<ArrowRight size={16} aria-hidden />
					</Link>
				))}
			</div>
		</section>
	);
}
