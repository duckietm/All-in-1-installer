"use client";

import { ArrowLeft, Loader2, Mail, Send, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
	closeHelpCenterTicket,
	liftBanFromHelpTicket,
	reopenHelpCenterTicket,
	replyHelpCenterTicket,
} from "@/actions/admin-help-tickets";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";

interface ThreadMessage {
	key: string;
	userId: number;
	username: string;
	isStaff: boolean;
	content: string;
	createdAt: string;
}

interface HelpTicketInfo {
	id: string;
	title: string;
	open: boolean;
	createdAt: string;
	updatedAt: string;
	categoryName?: string | null;
	creator: {
		id: number;
		username: string;
		rank: number;
		mail: string;
	} | null;
}

export function AdminHelpTicketDetail({
	ticket,
	messages: initialMessages,
	canEdit,
	canLiftBan = false,
	hasActiveBan = false,
	listHref = "/admin/help-tickets",
	hideRequesterContact = false,
}: {
	ticket: HelpTicketInfo;
	messages: ThreadMessage[];
	canEdit: boolean;
	/** Staff may lift requester bans (USERS_BAN). */
	canLiftBan?: boolean;
	hasActiveBan?: boolean;
	listHref?: string;
	/** Hide email/IP-style contact for mod-lite surfaces. */
	hideRequesterContact?: boolean;
}) {
	const t = useTranslations("pages.admin.helpTickets");
	const [messages, setMessages] = useState(initialMessages);
	const [reply, setReply] = useState("");
	const { run, isPending } = useServerAction();
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setMessages(initialMessages);
	}, [initialMessages]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	function handleReply() {
		if (!reply.trim() || isPending) return;
		run(
			() =>
				replyHelpCenterTicket({
					ticketId: ticket.id,
					content: reply.trim(),
				}),
			{
				successMessage: t("success.replied"),
				onSuccess: () => setReply(""),
			},
		);
	}

	function handleClose() {
		run(() => closeHelpCenterTicket({ ticketId: ticket.id }), {
			successMessage: t("success.closed"),
		});
	}

	function handleReopen() {
		run(() => reopenHelpCenterTicket({ ticketId: ticket.id }), {
			successMessage: t("success.reopened"),
		});
	}

	function handleLiftBan() {
		if (!ticket.creator || isPending) return;
		run(() => liftBanFromHelpTicket({ ticketId: ticket.id }), {
			successMessage: t("success.banLifted"),
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex items-start gap-4">
				<Link href={listHref}>
					<Button variant="ghost" size="icon" aria-label={t("backToList")}>
						<ArrowLeft className="h-4 w-4" />
					</Button>
				</Link>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-sm text-muted-foreground font-mono">
							#{ticket.id}
						</span>
						<Badge variant={ticket.open ? "default" : "secondary"}>
							{ticket.open ? t("statusOpen") : t("statusClosed")}
						</Badge>
						{ticket.categoryName ? (
							<Badge variant="outline">{ticket.categoryName}</Badge>
						) : null}
						{hasActiveBan ? (
							<Badge variant="destructive">{t("requesterBanned")}</Badge>
						) : null}
					</div>
					<h1 className="text-2xl font-bold">{ticket.title}</h1>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-[1fr_300px]">
				<div className="space-y-4">
					<Card className="overflow-hidden">
						<CardHeader className="pb-2 border-b">
							<CardTitle className="text-sm">{t("threadTitle")}</CardTitle>
						</CardHeader>
						<div className="max-h-[600px] overflow-y-auto p-4 space-y-4">
							{messages.map((msg) => (
								<div key={msg.key} className="flex gap-3">
									<div className="shrink-0">
										<div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-xs font-bold">
											{msg.isStaff ? (
												<Shield className="h-4 w-4 text-primary" />
											) : (
												<User className="h-4 w-4" />
											)}
										</div>
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<span
												className={`text-xs font-semibold ${msg.isStaff ? "text-primary" : ""}`}
											>
												{msg.username}
												{msg.isStaff ? ` (${t("staffBadge")})` : ""}
											</span>
											<span className="text-[10px] text-muted-foreground">
												{formatDate(new Date(msg.createdAt))}
											</span>
										</div>
										<div
											className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
												msg.isStaff
													? "bg-primary/10 border border-primary/20"
													: "bg-muted"
											}`}
										>
											<p className="whitespace-pre-wrap break-words">
												{msg.content}
											</p>
										</div>
									</div>
								</div>
							))}
							<div ref={messagesEndRef} />
						</div>

						{canEdit && ticket.open && (
							<div className="border-t p-4">
								<div className="flex gap-2">
									<Textarea
										value={reply}
										onChange={(e) => setReply(e.target.value)}
										placeholder={t("replyPlaceholder")}
										rows={3}
										maxLength={5000}
										className="resize-none"
										onKeyDown={(e) => {
											if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
												e.preventDefault();
												handleReply();
											}
										}}
									/>
									<Button
										onClick={handleReply}
										disabled={isPending || !reply.trim()}
										size="icon"
										className="shrink-0 h-auto"
										aria-label={t("replySubmit")}
									>
										{isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Send className="h-4 w-4" />
										)}
									</Button>
								</div>
								<p className="text-[10px] text-muted-foreground mt-1">
									{t("replyHint")}
								</p>
							</div>
						)}

						{!ticket.open && (
							<div className="border-t p-4 text-center text-sm text-muted-foreground">
								{t("closedHint")}
							</div>
						)}
					</Card>
				</div>

				<div className="space-y-4">
					{(canEdit || (canLiftBan && hasActiveBan)) && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">{t("actionsTitle")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								{canLiftBan && hasActiveBan && ticket.creator ? (
									<Button
										variant="destructive"
										size="sm"
										className="w-full"
										disabled={isPending}
										onClick={handleLiftBan}
									>
										{t("liftBanSubmit")}
									</Button>
								) : null}
								{canEdit && ticket.open ? (
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										disabled={isPending}
										onClick={handleClose}
									>
										{t("closeSubmit")}
									</Button>
								) : null}
								{canEdit && !ticket.open ? (
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										disabled={isPending}
										onClick={handleReopen}
									>
										{t("reopenSubmit")}
									</Button>
								) : null}
							</CardContent>
						</Card>
					)}

					{ticket.creator && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">{t("requesterTitle")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								<Link
									href={
										hideRequesterContact
											? `/u/${encodeURIComponent(ticket.creator.username)}`
											: `/admin/users/show/${ticket.creator.id}`
									}
									className="flex items-center gap-2 text-sm font-medium hover:text-primary"
								>
									<User className="h-3.5 w-3.5" />
									{ticket.creator.username}
									<Badge variant="outline" className="text-[10px]">
										{t("rankLabel", { rank: ticket.creator.rank })}
									</Badge>
								</Link>
								{!hideRequesterContact && ticket.creator.mail ? (
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<Mail className="h-3 w-3" />
										{ticket.creator.mail}
									</div>
								) : null}
							</CardContent>
						</Card>
					)}

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">{t("detailsTitle")}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2 text-xs text-muted-foreground">
							<div className="flex justify-between gap-2">
								<span>{t("colCreated")}</span>
								<span>{formatDate(new Date(ticket.createdAt))}</span>
							</div>
							<div className="flex justify-between gap-2">
								<span>{t("colUpdated")}</span>
								<span>{formatDate(new Date(ticket.updatedAt))}</span>
							</div>
							<div className="flex justify-between gap-2">
								<span>{t("messageCountLabel")}</span>
								<span>{messages.length}</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
