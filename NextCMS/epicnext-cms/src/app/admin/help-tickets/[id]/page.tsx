import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { positiveBigInt } from "@/lib/api";
import { unixNow } from "@/lib/bans";
import {
	Ban,
	db,
	User,
	WebsiteHelpCenterCategories,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { AdminHelpTicketDetail } from "./admin-help-ticket-detail";

export default async function AdminHelpTicketDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.TICKETS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.helpTickets");
	const { id } = await params;
	const ticketId = positiveBigInt(id);
	if (!ticketId) notFound();

	const [ticket] = await db
		.select({
			id: WebsiteHelpCenterTickets.id,
			userId: WebsiteHelpCenterTickets.userId,
			categoryId: WebsiteHelpCenterTickets.categoryId,
			title: WebsiteHelpCenterTickets.title,
			content: WebsiteHelpCenterTickets.content,
			open: WebsiteHelpCenterTickets.open,
			createdAt: WebsiteHelpCenterTickets.createdAt,
			updatedAt: WebsiteHelpCenterTickets.updatedAt,
		})
		.from(WebsiteHelpCenterTickets)
		.where(eq(WebsiteHelpCenterTickets.id, ticketId))
		.limit(1);

	if (!ticket) notFound();

	const replies = await db
		.select({
			id: WebsiteHelpCenterTicketReplies.id,
			userId: WebsiteHelpCenterTicketReplies.userId,
			content: WebsiteHelpCenterTicketReplies.content,
			createdAt: WebsiteHelpCenterTicketReplies.createdAt,
		})
		.from(WebsiteHelpCenterTicketReplies)
		.where(eq(WebsiteHelpCenterTicketReplies.ticketId, ticket.id))
		.orderBy(asc(WebsiteHelpCenterTicketReplies.id));

	const authorIds = [
		...new Set([
			...(ticket.userId != null ? [ticket.userId] : []),
			...replies.map((r) => r.userId),
		]),
	];

	const now = unixNow();
	const [users, categoryRows, activeBanRows] = await Promise.all([
		authorIds.length > 0
			? db
					.select({
						id: User.id,
						username: User.username,
						rank: User.rank,
						mail: User.mail,
					})
					.from(User)
					.where(inArray(User.id, authorIds))
			: Promise.resolve([]),
		ticket.categoryId != null
			? db
					.select({ name: WebsiteHelpCenterCategories.name })
					.from(WebsiteHelpCenterCategories)
					.where(eq(WebsiteHelpCenterCategories.id, ticket.categoryId))
					.limit(1)
			: Promise.resolve([]),
		ticket.userId != null
			? db
					.select({ id: Ban.id })
					.from(Ban)
					.where(
						and(
							eq(Ban.userId, ticket.userId),
							or(eq(Ban.banExpire, 0), gt(Ban.banExpire, now)),
						),
					)
					.limit(1)
			: Promise.resolve([]),
	]);

	const category = categoryRows[0] ?? null;
	const activeBan = activeBanRows[0] ?? null;

	const userById = new Map(users.map((u) => [u.id, u]));
	const openerId = ticket.userId;
	const minStaffRank = await getMinStaffRank();

	const messages = [
		{
			key: "opening",
			userId: openerId ?? 0,
			username:
				openerId != null
					? (userById.get(openerId)?.username ?? `#${openerId}`)
					: "—",
			isStaff: false,
			content: ticket.content,
			createdAt: (ticket.createdAt ?? new Date()).toISOString(),
		},
		...replies.map((r) => {
			const user = userById.get(r.userId);
			const isStaff =
				r.userId !== openerId && (user?.rank ?? 0) >= minStaffRank;
			return {
				key: String(r.id),
				userId: r.userId,
				username: user?.username ?? `#${r.userId}`,
				isStaff,
				content: r.content,
				createdAt: (r.createdAt ?? new Date()).toISOString(),
			};
		}),
	];

	const creator = openerId != null ? userById.get(openerId) : undefined;

	const canEdit = canAccess(permissions, PERMS.TICKETS_EDIT, session.user.rank);
	const canLiftBan = canAccess(permissions, PERMS.USERS_BAN, session.user.rank);
	const isBanAppeal =
		/ban\s*appeal/i.test(ticket.title) ||
		/ban\s*appeal/i.test(category?.name ?? "");
	const queues = await fetchTicketQueueOpenCounts();

	return (
		<div className="space-y-6">
			<TicketQueueBanner
				hint={t("queueHint")}
				otherHref="/admin/tickets"
				otherLabel={t("queueOtherCta")}
				countsLine={t("queueCounts", {
					here: queues.helpOpen,
					other: queues.cmsOpen,
				})}
			/>
			<AdminHelpTicketDetail
				ticket={{
					id: String(ticket.id),
					title: ticket.title,
					open: ticket.open,
					createdAt: (ticket.createdAt ?? new Date()).toISOString(),
					updatedAt: (ticket.updatedAt ?? new Date()).toISOString(),
					categoryName: category?.name ?? (isBanAppeal ? "Ban appeal" : null),
					creator: creator
						? {
								id: creator.id,
								username: creator.username,
								rank: creator.rank,
								mail: creator.mail ?? "",
							}
						: null,
				}}
				messages={messages}
				canEdit={canEdit}
				canLiftBan={canLiftBan}
				hasActiveBan={!!activeBan}
			/>
		</div>
	);
}
