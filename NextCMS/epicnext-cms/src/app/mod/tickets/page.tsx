import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { UnifiedTicketsTable } from "@/components/admin/unified-tickets-table";
import Link from "@/components/link";
import { requireModPermission } from "@/lib/admin/guard";
import {
	fetchUnifiedTicketInbox,
	type TicketInboxTypeFilter,
} from "@/lib/admin/ticket-inbox";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { parseListParams } from "@/lib/admin-helpers";
import { PERMS } from "@/lib/permissions";

export default async function ModTicketInboxPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	await requireModPermission([PERMS.MOD_TICKETS_VIEW, PERMS.TICKETS_VIEW]);

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
			base: "mod",
		}),
		fetchTicketQueueOpenCounts(),
	]);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="font-semibold text-[var(--admin-text)]">
					{t("modNavLabel")}
				</span>
				<Link
					href="/mod/tickets"
					className="rounded-md px-2 py-1 no-underline text-[var(--admin-accent)] hover:underline"
				>
					{t("modNavInbox")}
				</Link>
				<Link
					href="/mod/tickets/desk"
					className="rounded-md px-2 py-1 no-underline text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
				>
					{t("modNavDesk")}
				</Link>
				<Link
					href="/mod/help-tickets"
					className="rounded-md px-2 py-1 no-underline text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
				>
					{t("modNavHelp")}
				</Link>
			</div>
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
