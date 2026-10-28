"use client";

import {
	AlertTriangle,
	ArrowLeft,
	Ban,
	CheckCircle2,
	MessageSquare,
	Shield,
	User,
	VolumeX,
	Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	assignCfhTicket,
	closeCfhTicket,
	quickAlert,
	quickKick,
	quickMute,
	updateCfhState,
} from "@/actions/moderation";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const CFH_STATES: Record<number, { class: string }> = {
	0: {
		class: "bg-[var(--admin-error-subtle)] text-[var(--admin-error)]",
	},
	1: {
		class: "bg-[var(--admin-warning-subtle)] text-[var(--admin-warning)]",
	},
	2: { class: "bg-muted text-muted-foreground" },
};

interface UserInfo {
	id: number;
	username: string;
	look: string;
	rank: number;
	online: string;
	ipRegister: string;
	mail: string | null;
}

interface BanRecord {
	id: number;
	reason: string;
	type: string;
	staff: string;
	timestamp: number;
}

export function CfhDetail({
	ticket,
	sender,
	reported,
	moderator,
	banHistory,
	canEdit,
	currentUserId,
	listHref = "/admin/moderation/cfh",
	userLinkMode = "admin",
}: {
	ticket: {
		id: number;
		state: number;
		type: number;
		timestamp: number;
		issue: string;
		roomId: number;
		category: number;
		score: number;
	};
	sender: UserInfo | null;
	reported: UserInfo | null;
	moderator: UserInfo | null;
	banHistory: { count: number; recent: BanRecord[] };
	canEdit: boolean;
	currentUserId: number;
	listHref?: string;
	userLinkMode?: "admin" | "public";
}) {
	void currentUserId;
	const t = useTranslations("pages.admin.moderation.cfh.id.cfhDetail");
	const { run, isPending } = useServerAction();
	const [alertMsg, setAlertMsg] = useState("");
	const [muteDuration, setMuteDuration] = useState(10);

	const state = CFH_STATES[ticket.state] ?? CFH_STATES[0];
	const stateKey =
		ticket.state === 1
			? "statePicked"
			: ticket.state === 2
				? "stateClosed"
				: "stateOpen";

	function userHref(user: UserInfo) {
		if (userLinkMode === "public") {
			return `/u/${encodeURIComponent(user.username)}`;
		}
		return `/admin/users/show/${user.id}`;
	}

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
							{t("cfhId", { id: ticket.id })}
						</span>
						<Badge className={state.class}>{t(stateKey)}</Badge>
						<span className="text-xs text-muted-foreground">
							{t("typeCategory", {
								type: ticket.type,
								category: ticket.category,
							})}
						</span>
					</div>
					<h1 className="text-xl font-bold">{t("title")}</h1>
					<p className="text-xs text-muted-foreground">
						{t("roomMeta", {
							when: formatDate(new Date(ticket.timestamp * 1000)),
							room: ticket.roomId,
						})}
					</p>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-[1fr_300px]">
				{/* Main content */}
				<div className="space-y-4">
					{/* Issue */}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm flex items-center gap-2">
								<MessageSquare className="h-4 w-4" />
								{t("reportMessage")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm leading-relaxed whitespace-pre-wrap">
								{ticket.issue || t("noDescription")}
							</p>
						</CardContent>
					</Card>

					{/* Users involved */}
					<div className="grid gap-4 sm:grid-cols-2">
						{/* Sender */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm text-[var(--admin-info)]">
									Reporter
								</CardTitle>
							</CardHeader>
							<CardContent>
								{sender ? (
									<Link
										href={userHref(sender)}
										className="flex items-center gap-3 hover:text-primary no-underline"
									>
										<User className="h-4 w-4" />
										<div>
											<p className="text-sm font-bold">{sender.username}</p>
											<p className="text-xs text-muted-foreground">
												Rank {sender.rank} ·{" "}
												{sender.online === "1" ? "Online" : "Offline"}
											</p>
										</div>
									</Link>
								) : (
									<p className="text-sm text-muted-foreground">Unknown user</p>
								)}
							</CardContent>
						</Card>

						{/* Reported */}
						<Card className="border-[var(--admin-error-border)]">
							<CardHeader className="pb-2">
								<CardTitle className="text-sm text-[var(--admin-error)]">
									Reported User
								</CardTitle>
							</CardHeader>
							<CardContent>
								{reported ? (
									<div>
										<Link
											href={userHref(reported)}
											className="flex items-center gap-3 hover:text-primary no-underline"
										>
											<AlertTriangle className="h-4 w-4 text-[var(--admin-error)]" />
											<div>
												<p className="text-sm font-bold">{reported.username}</p>
												<p className="text-xs text-muted-foreground">
													Rank {reported.rank} ·{" "}
													{reported.online === "1" ? "Online" : "Offline"} ·{" "}
													{banHistory.count} bans
												</p>
											</div>
										</Link>

										{/* Quick actions on reported user */}
										{canEdit && (
											<div className="mt-3 pt-3 border-t space-y-2">
												<div className="flex gap-2">
													<Button
														size="sm"
														variant="destructive"
														className="flex-1"
														disabled={isPending}
														onClick={() =>
															run(() => quickKick({ userId: reported.id }), {
																successMessage: "User kicked",
															})
														}
													>
														<Zap className="mr-1 h-3 w-3" /> Kick
													</Button>
													<Button
														size="sm"
														variant="outline"
														className="flex-1"
														disabled={isPending}
														onClick={() =>
															run(
																() =>
																	quickMute({
																		userId: reported.id,
																		duration: muteDuration,
																	}),
																{
																	successMessage: `Muted for ${muteDuration}min`,
																},
															)
														}
													>
														<VolumeX className="mr-1 h-3 w-3" /> Mute
													</Button>
												</div>
												<Input
													type="number"
													min={1}
													max={1440}
													value={muteDuration}
													onChange={(e) =>
														setMuteDuration(Number(e.target.value))
													}
													className="h-7 text-xs"
													placeholder="Mute duration (min)"
												/>
												<div className="flex gap-2">
													<Textarea
														value={alertMsg}
														onChange={(e) => setAlertMsg(e.target.value)}
														placeholder="Alert message..."
														rows={2}
														className="text-xs resize-none"
													/>
													<Button
														size="sm"
														variant="outline"
														className="shrink-0"
														disabled={isPending || !alertMsg.trim()}
														onClick={() => {
															run(
																() =>
																	quickAlert({
																		userId: reported.id,
																		message: alertMsg.trim(),
																	}),
																{
																	successMessage: "Alert sent",
																	onSuccess: () => setAlertMsg(""),
																},
															);
														}}
													>
														Alert
													</Button>
												</div>
											</div>
										)}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">Unknown user</p>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Ban history */}
					{banHistory.recent.length > 0 && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm flex items-center gap-2">
									<Ban className="h-4 w-4 text-[var(--admin-error)]" />
									Ban History ({banHistory.count})
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="divide-y divide-border">
									{banHistory.recent.map((ban) => (
										<div
											key={ban.id}
											className="py-2 first:pt-0 last:pb-0 text-xs"
										>
											<p className="font-medium">{ban.reason || "No reason"}</p>
											<p className="text-muted-foreground">
												{ban.type} · by {ban.staff} ·{" "}
												{formatDate(new Date(ban.timestamp * 1000), "date")}
											</p>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}
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
										value={String(ticket.state)}
										onValueChange={(v) =>
											run(
												() =>
													updateCfhState({
														ticketId: ticket.id,
														state: Number(v),
													}),
												{
													successMessage: "Status updated",
												},
											)
										}
									>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="0" className="text-xs">
												Open
											</SelectItem>
											<SelectItem value="1" className="text-xs">
												Picked
											</SelectItem>
											<SelectItem value="2" className="text-xs">
												Closed
											</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<Button
									variant="outline"
									size="sm"
									className="w-full"
									disabled={isPending}
									onClick={() =>
										run(() => assignCfhTicket({ ticketId: ticket.id }), {
											successMessage: "Assigned to you",
										})
									}
								>
									<Shield className="mr-1.5 h-3.5 w-3.5" /> Assign to me
								</Button>

								<Button
									variant="outline"
									size="sm"
									className="w-full text-[var(--admin-success)]"
									disabled={isPending || ticket.state === 2}
									onClick={() =>
										run(() => closeCfhTicket({ ticketId: ticket.id }), {
											successMessage: "Ticket closed",
										})
									}
								>
									<CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Close Ticket
								</Button>
							</CardContent>
						</Card>
					)}

					{/* Moderator */}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Assigned Moderator</CardTitle>
						</CardHeader>
						<CardContent>
							{moderator ? (
								<Link
									href={userHref(moderator)}
									className="flex items-center gap-2 text-sm hover:text-primary no-underline"
								>
									<Shield className="h-3.5 w-3.5 text-primary" />
									{moderator.username}
								</Link>
							) : (
								<p className="text-xs text-muted-foreground">Unassigned</p>
							)}
						</CardContent>
					</Card>

					{/* Details */}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Details</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2 text-xs text-muted-foreground">
							<div className="flex justify-between">
								<span>Created</span>
								<span>{formatDate(new Date(ticket.timestamp * 1000))}</span>
							</div>
							<div className="flex justify-between">
								<span>Room</span>
								<span>#{ticket.roomId}</span>
							</div>
							<div className="flex justify-between">
								<span>Type</span>
								<span>{ticket.type}</span>
							</div>
							<div className="flex justify-between">
								<span>Category</span>
								<span>{ticket.category}</span>
							</div>
							<div className="flex justify-between">
								<span>Score</span>
								<span>{ticket.score}</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
