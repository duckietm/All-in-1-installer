"use client";

import {
	ArrowLeft,
	Calendar,
	Globe,
	Loader2,
	Mail,
	Send,
	Shield,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	adminReplyTicket,
	assignTicket,
	updateTicketPriority,
	updateTicketStatus,
} from "@/actions/tickets";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format-date";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/validators/ticket";

interface TicketMessage {
	id: number;
	message: string;
	isStaff: boolean;
	createdAt: string;
	user: { id: number; username: string; look: string; rank: number };
}

interface TicketInfo {
	id: number;
	subject: string;
	category: string;
	priority: string;
	status: string;
	createdAt: string;
	closedAt: string | null;
	creator: {
		id: number;
		username: string;
		look: string;
		rank: number;
		mail: string;
		ipRegister: string;
		accountCreated: number;
	};
	assignee: { id: number; username: string } | null;
}

interface StaffMember {
	id: number;
	username: string;
}

const STATUS_COLORS: Record<string, string> = {
	open: "bg-[var(--admin-info-subtle)] text-[var(--admin-info)]",
	in_progress: "bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)]",
	waiting: "bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)]",
	closed: "bg-muted text-muted-foreground",
};

const PRIORITY_COLORS: Record<string, string> = {
	low: "text-muted-foreground",
	normal: "text-[var(--admin-info)]",
	high: "text-[var(--admin-warning)]",
	urgent: "text-[var(--admin-error)]",
};

export function AdminTicketDetail({
	ticket,
	messages: initialMessages,
	staffMembers,
	currentUserId,
	canEdit,
	listHref = "/admin/tickets",
	userLinkMode = "admin",
}: {
	ticket: TicketInfo;
	messages: TicketMessage[];
	staffMembers: StaffMember[];
	currentUserId: number;
	canEdit: boolean;
	listHref?: string;
	userLinkMode?: "admin" | "public";
}) {
	const [messages] = useState(initialMessages);
	const [reply, setReply] = useState("");
	const { run, isPending } = useServerAction();
	const messagesEndRef = useRef<HTMLDivElement>(null);

	function creatorHref() {
		if (userLinkMode === "public") {
			return `/u/${encodeURIComponent(ticket.creator.username)}`;
		}
		return `/admin/users/show/${ticket.creator.id}`;
	}

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	function handleReply() {
		if (!reply.trim() || isPending) return;
		run(
			() => adminReplyTicket({ ticketId: ticket.id, message: reply.trim() }),
			{
				successMessage: "Reply sent!",
				onSuccess: () => setReply(""),
			},
		);
	}

	function handleStatusChange(status: string) {
		run(
			() =>
				updateTicketStatus({
					ticketId: ticket.id,
					status: status as (typeof TICKET_STATUSES)[number],
				}),
			{
				successMessage: `Status changed to ${status}`,
			},
		);
	}

	function handleAssign(assigneeId: string) {
		const id = assigneeId === "unassign" ? null : Number(assigneeId);
		run(() => assignTicket({ ticketId: ticket.id, assigneeId: id }), {
			successMessage: id ? "Ticket assigned" : "Ticket unassigned",
		});
	}

	function handlePriorityChange(priority: string) {
		run(
			() =>
				updateTicketPriority({
					ticketId: ticket.id,
					priority: priority as (typeof TICKET_PRIORITIES)[number],
				}),
			{
				successMessage: `Priority changed to ${priority}`,
			},
		);
	}

	const isClosed = ticket.status === "closed";

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-start gap-4">
				<Link href={listHref}>
					<Button variant="ghost" size="icon">
						<ArrowLeft className="h-4 w-4" />
					</Button>
				</Link>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-sm text-muted-foreground font-mono">
							#{ticket.id}
						</span>
						<Badge className={STATUS_COLORS[ticket.status]}>
							{ticket.status.replace("_", " ")}
						</Badge>
						<Badge
							variant="outline"
							className={`capitalize ${PRIORITY_COLORS[ticket.priority]}`}
						>
							{ticket.priority}
						</Badge>
						<Badge variant="outline" className="capitalize">
							{ticket.category}
						</Badge>
					</div>
					<h1 className="text-2xl font-bold">{ticket.subject}</h1>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-[1fr_300px]">
				{/* Messages */}
				<div className="space-y-4">
					<Card className="overflow-hidden">
						<div className="max-h-[600px] overflow-y-auto p-4 space-y-4">
							{messages.map((msg) => (
								<div key={msg.id} className="flex gap-3">
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
												{msg.user.username}
												{msg.isStaff && " (Staff)"}
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
												{msg.message}
											</p>
										</div>
									</div>
								</div>
							))}
							<div ref={messagesEndRef} />
						</div>

						{/* Reply */}
						{canEdit && !isClosed && (
							<div className="border-t p-4">
								<div className="flex gap-2">
									<Textarea
										value={reply}
										onChange={(e) => setReply(e.target.value)}
										placeholder="Reply as staff..."
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
									>
										{isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Send className="h-4 w-4" />
										)}
									</Button>
								</div>
								<p className="text-[10px] text-muted-foreground mt-1">
									Ctrl+Enter to send. Your reply will be marked as staff.
								</p>
							</div>
						)}

						{isClosed && (
							<div className="border-t p-4 text-center text-sm text-muted-foreground">
								Ticket closed{" "}
								{ticket.closedAt
									? `on ${formatDate(new Date(ticket.closedAt), "date")}`
									: ""}
							</div>
						)}
					</Card>
				</div>

				{/* Sidebar */}
				<div className="space-y-4">
					{/* Actions */}
					{canEdit && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Actions</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<div>
									<span className="text-xs text-muted-foreground mb-1 block">
										Status
									</span>
									<Select
										value={ticket.status}
										onValueChange={handleStatusChange}
									>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{TICKET_STATUSES.map((s) => (
												<SelectItem
													key={s}
													value={s}
													className="text-xs capitalize"
												>
													{s.replace("_", " ")}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<div>
									<span className="text-xs text-muted-foreground mb-1 block">
										Priority
									</span>
									<Select
										value={ticket.priority}
										onValueChange={handlePriorityChange}
									>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{TICKET_PRIORITIES.map((p) => (
												<SelectItem
													key={p}
													value={p}
													className="text-xs capitalize"
												>
													{p}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<div>
									<span className="text-xs text-muted-foreground mb-1 block">
										Assign to
									</span>
									<Select
										value={
											ticket.assignee ? String(ticket.assignee.id) : "unassign"
										}
										onValueChange={handleAssign}
									>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue placeholder="Unassigned" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="unassign" className="text-xs">
												Unassigned
											</SelectItem>
											{staffMembers.map((s) => (
												<SelectItem
													key={s.id}
													value={String(s.id)}
													className="text-xs"
												>
													{s.username}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<Button
									variant="outline"
									size="sm"
									className="w-full"
									onClick={() => {
										handleAssign(String(currentUserId));
									}}
								>
									Assign to me
								</Button>
							</CardContent>
						</Card>
					)}

					{/* User info */}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Requester</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							<Link
								href={creatorHref()}
								className="flex items-center gap-2 text-sm font-medium hover:text-primary"
							>
								<User className="h-3.5 w-3.5" />
								{ticket.creator.username}
								<Badge variant="outline" className="text-[10px]">
									Rank {ticket.creator.rank}
								</Badge>
							</Link>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<Mail className="h-3 w-3" />
								{ticket.creator.mail}
							</div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<Globe className="h-3 w-3" />
								{ticket.creator.ipRegister}
							</div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<Calendar className="h-3 w-3" />
								Registered{" "}
								{formatDate(
									new Date(ticket.creator.accountCreated * 1000),
									"date",
								)}
							</div>
						</CardContent>
					</Card>

					{/* Ticket info */}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Details</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2 text-xs text-muted-foreground">
							<div className="flex justify-between">
								<span>Created</span>
								<span>{formatDate(new Date(ticket.createdAt))}</span>
							</div>
							{ticket.closedAt && (
								<div className="flex justify-between">
									<span>Closed</span>
									<span>{formatDate(new Date(ticket.closedAt))}</span>
								</div>
							)}
							<div className="flex justify-between">
								<span>Messages</span>
								<span>{messages.length}</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
