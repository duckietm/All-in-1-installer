import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { UnifiedTicketsTable } from "@/components/admin/unified-tickets-table";
import {
	fetchUnifiedTicketInbox,
	type TicketInboxTypeFilter,
} from "@/lib/admin/ticket-inbox";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { parseListParams } from "@/lib/admin-helpers";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function AdminTicketInboxPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.TICKETS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.ticketInbox");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const typeRaw = raw.filter_type || "all";
	const type: TicketInboxTypeFilter =
		typeRaw === "cms" || typeRaw === "help" ? typeRaw : "all";
	const statusFilter = raw.filter_status || "open";
	const openOnly = statusFilter !== "all";

	const [inbox, queues] = await Promise.all([
		fetchUnifiedTicketInbox({
			page: parsed.page,
			perPage: parsed.perPage,
			search: parsed.search,
			type,
			openOnly,
			base: "admin",
		}),
		fetchTicketQueueOpenCounts(),
	]);

	return (
		<div className="space-y-6">
			<p className="m-0 text-sm text-[var(--admin-text-muted)]">{t("hint")}</p>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
				<StatusCard label={t("statCmsOpen")} value={queues.cmsOpen} icon="🎫" />
				<StatusCard
					label={t("statHelpOpen")}
					value={queues.helpOpen}
					state={queues.helpOpen > 0 ? "warn" : "neutral"}
					icon="🛟"
				/>
				<StatusCard
					label={t("statTotal")}
					value={queues.cmsOpen + queues.helpOpen}
					icon="📥"
				/>
			</div>

			{inbox.total === 0 && !parsed.search ? (
				<div className="admin-empty">{t("noTickets")}</div>
			) : (
				<UnifiedTicketsTable
					data={{
						rows: inbox.rows,
						total: inbox.total,
						page: inbox.page,
						perPage: inbox.perPage,
						lastPage: inbox.lastPage,
					}}
				/>
			)}
		</div>
	);
}
