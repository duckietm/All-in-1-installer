import { asc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { closeHelpTicket, replyHelpTicket } from "@/actions/help-tickets";
import Link from "@/components/link";
import { ContentCard } from "@/components/public/ui";
import { positiveBigInt } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
	db,
	User,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";

type SearchParams = Promise<{
	replied?: string;
	closed?: string;
	error?: string;
}>;

function feedbackStyle(tone: "success" | "error"): CSSProperties {
	const accent =
		tone === "error" ? "var(--color-danger)" : "var(--color-primary)";
	return {
		margin: 0,
		padding: "0.85rem 1rem",
		borderRadius: "var(--radius-md)",
		border: `1px solid ${accent}`,
		color: "var(--color-text-readable, var(--color-text))",
		fontSize: "0.9rem",
		fontWeight: 600,
		background: "var(--color-surface)",
		borderLeft: `4px solid ${accent}`,
	};
}

export default async function HelpTicketDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: SearchParams;
}) {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const t = await getTranslations("pages.helpTicketDetail");
	const { id } = await params;
	const { replied, closed, error } = await searchParams;
	const ticketId = positiveBigInt(id);
	if (!ticketId) notFound();

	const userId = Number(session.user.id);

	let ticket: {
		id: bigint;
		userId: number | null;
		title: string;
		content: string;
		open: boolean;
		createdAt: Date | null;
	} | null = null;
	let replies: {
		id: bigint;
		userId: number;
		content: string;
		createdAt: Date | null;
	}[] = [];

	try {
		const [row] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				userId: WebsiteHelpCenterTickets.userId,
				title: WebsiteHelpCenterTickets.title,
				content: WebsiteHelpCenterTickets.content,
				open: WebsiteHelpCenterTickets.open,
				createdAt: WebsiteHelpCenterTickets.createdAt,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);
		ticket = row ?? null;
	} catch {
		ticket = null;
	}

	if (!ticket || ticket.userId !== userId) notFound();

	try {
		replies = await db
			.select({
				id: WebsiteHelpCenterTicketReplies.id,
				userId: WebsiteHelpCenterTicketReplies.userId,
				content: WebsiteHelpCenterTicketReplies.content,
				createdAt: WebsiteHelpCenterTicketReplies.createdAt,
			})
			.from(WebsiteHelpCenterTicketReplies)
			.where(eq(WebsiteHelpCenterTicketReplies.ticketId, ticket.id))
			.orderBy(asc(WebsiteHelpCenterTicketReplies.id));
	} catch {
		replies = [];
	}

	const authorIds = [...new Set([userId, ...replies.map((r) => r.userId)])];
	let users: { id: number; username: string }[] = [];
	try {
		users = await db
			.select({ id: User.id, username: User.username })
			.from(User)
			.where(inArray(User.id, authorIds));
	} catch {
		users = [];
	}
	const usernameById = new Map(users.map((u) => [u.id, u.username]));
	const openerName =
		usernameById.get(userId) ?? t("userNumber", { id: userId });

	const errorMessage =
		error === "invalid"
			? t("errors.invalid")
			: error === "not_found"
				? t("errors.notFound")
				: error === "closed_ticket"
					? t("errors.closedTicket")
					: error === "moderated"
						? t("errors.moderated")
						: error === "ratelimit"
							? t("errors.ratelimit")
							: error
								? t("errors.error")
								: null;

	type MessageRow = {
		key: string;
		authorId: number;
		content: string;
		createdAt: Date | null;
	};

	const messages: MessageRow[] = [
		{
			key: "opening",
			authorId: userId,
			content: ticket.content,
			createdAt: ticket.createdAt,
		},
		...replies.map((r) => ({
			key: String(r.id),
			authorId: r.userId,
			content: r.content,
			createdAt: r.createdAt,
		})),
	];

	return (
		<section className="page-grid">
			{replied === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.replied")}
				</div>
			) : null}
			{closed === "1" ? (
				<div role="status" style={feedbackStyle("success")}>
					{t("success.closed")}
				</div>
			) : null}
			{errorMessage ? (
				<div role="alert" style={feedbackStyle("error")}>
					{errorMessage}
				</div>
			) : null}

			<p style={{ margin: 0 }}>
				<Link href="/help/tickets">{t("backToList")}</Link>
			</p>

			<ContentCard
				icon="🎫"
				title={ticket.title}
				subtitle={t("ticketId", { id: String(ticket.id) })}
			>
				<span className={`online-badge${ticket.open ? " online" : ""}`}>
					<span className="online-dot" aria-hidden />
					{ticket.open ? t("statusOpen") : t("statusClosed")}
				</span>
			</ContentCard>

			<ContentCard
				icon="💬"
				title={t("messagesTitle")}
				subtitle={t("messagesSubtitle", { count: messages.length })}
			>
				<ul
					style={{
						listStyle: "none",
						margin: 0,
						padding: 0,
						display: "grid",
						gap: "1rem",
					}}
				>
					{messages.map((msg, index) => {
						const username =
							msg.authorId === userId
								? openerName
								: usernameById.get(msg.authorId);
						return (
							<li
								key={msg.key}
								style={{
									padding: "0.85rem 1rem",
									borderRadius: "var(--radius-md)",
									border: "1px solid var(--color-border, rgba(0,0,0,0.08))",
									background: "var(--color-surface)",
								}}
							>
								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										justifyContent: "space-between",
										gap: "0.35rem",
										marginBottom: "0.5rem",
									}}
								>
									<span style={{ fontWeight: 700 }}>
										{index === 0 ? (
											t("you")
										) : username ? (
											<Link href={`/u/${username}`}>{username}</Link>
										) : (
											<span className="muted">
												{t("userNumber", { id: msg.authorId })}
											</span>
										)}
									</span>
									<span className="muted" style={{ fontSize: "0.85rem" }}>
										{formatDate(msg.createdAt, "datetime", "")}
									</span>
								</div>
								<p
									style={{
										margin: 0,
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
									}}
								>
									{msg.content}
								</p>
							</li>
						);
					})}
				</ul>
			</ContentCard>

			{ticket.open ? (
				<>
					<ContentCard
						icon="✍️"
						title={t("replyTitle")}
						subtitle={t("replySubtitle")}
					>
						<form action={replyHelpTicket}>
							<input type="hidden" name="ticketId" value={String(ticket.id)} />
							<textarea
								name="content"
								required
								rows={5}
								maxLength={5000}
								placeholder={t("replyPlaceholder")}
								style={{
									width: "100%",
									marginBottom: "0.75rem",
									resize: "vertical",
								}}
							/>
							<button type="submit" className="btn btn-primary">
								{t("replySubmit")}
							</button>
						</form>
					</ContentCard>

					<ContentCard
						icon="✅"
						title={t("closeTitle")}
						subtitle={t("closeSubtitle")}
					>
						<form action={closeHelpTicket}>
							<input type="hidden" name="ticketId" value={String(ticket.id)} />
							<button type="submit" className="btn btn-outline">
								{t("closeSubmit")}
							</button>
						</form>
					</ContentCard>
				</>
			) : (
				<p className="muted" style={{ margin: 0 }}>
					{t("closedHint")}
				</p>
			)}
		</section>
	);
}
