import { asc, eq, inArray } from "drizzle-orm";
import { CalendarDays, Gift, Trophy, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, User, WebsiteEvent, WebsiteEventType } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { EventForm } from "../event-form";
import { EventPrizesManager } from "./event-prizes";
import { EventRegistrations } from "./event-registrations";
import { EventWinnersManager } from "./event-winners";

export default async function EventDetailPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.EVENTS_EDIT, session.user.rank)) {
		redirect("/admin/events");
	}

	const eventId = parseInt(id, 10);
	if (Number.isNaN(eventId)) notFound();

	const t = await getTranslations("pages.admin.events");
	const tHubs = await getTranslations("pages.admin.hubs");

	const event = await db.query.WebsiteEvent.findFirst({
		where: eq(WebsiteEvent.id, eventId),
		with: {
			type: true,
			prizes: { orderBy: (p, { asc: a }) => [a(p.position)] },
			winners: { orderBy: (w, { asc: a }) => [a(w.position)] },
			registrations: { orderBy: (r, { desc: d }) => [d(r.createdAt)] },
		},
	});

	if (!event) notFound();

	const eventTypes = await db
		.select()
		.from(WebsiteEventType)
		.where(eq(WebsiteEventType.isActive, 1))
		.orderBy(asc(WebsiteEventType.name));

	// Fetch usernames for registrations and winners
	const userIds = [
		...event.registrations.map((r) => r.userId),
		...event.winners.map((w) => w.userId),
	];
	const users =
		userIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, [...new Set(userIds)]))
			: [];
	const userMap = new Map(users.map((u) => [u.id, u.username]));

	const statusLabel: Record<string, string> = {
		published: t("statusPublished"),
		draft: t("statusDraft"),
		cancelled: t("statusCancelled"),
		completed: t("statusCompleted"),
	};

	return (
		<div className="space-y-6">
			<div>
				<AdminBreadcrumb
					items={[
						{ label: tHubs("tabs.events"), href: "/admin/events" },
						{ label: event.title },
					]}
				/>
				<div className="flex items-center gap-3">
					<h1 className="m-0 text-2xl font-extrabold text-[var(--admin-text)]">
						{event.title}
					</h1>
					<Badge
						variant={
							event.status === "published"
								? "default"
								: event.status === "cancelled"
									? "destructive"
									: "secondary"
						}
					>
						{statusLabel[event.status] ?? event.status}
					</Badge>
				</div>
				<p className="m-0 mt-1 text-sm text-[var(--admin-text-muted)]">
					{event.type.name} &middot; {formatDate(new Date(event.startsAt))}
				</p>
			</div>

			{/* Stats */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statRegistrations")}
						</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{event.registrations.length}
						</div>
						{event.maxPlayers && (
							<p className="text-xs text-muted-foreground">
								{t("maxPlayers", { count: event.maxPlayers })}
							</p>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statPrizes")}
						</CardTitle>
						<Gift className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{event.prizes.length}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statWinners")}
						</CardTitle>
						<Trophy className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{event.winners.length}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("statTime")}
						</CardTitle>
						<CalendarDays className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-sm font-medium">
							{new Date(event.startsAt) > new Date()
								? t("timeUpcoming")
								: t("timePast")}
						</div>
						{event.endsAt && (
							<p className="text-xs text-muted-foreground">
								{t("endsAt", {
									date: formatDate(new Date(event.endsAt)),
								})}
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Edit form */}
			<EventForm
				eventTypes={eventTypes}
				defaultValues={{
					id: event.id,
					title: event.title,
					description: event.description,
					typeId: event.typeId,
					roomId: event.roomId,
					startsAt: event.startsAt,
					endsAt: event.endsAt,
					maxPlayers: event.maxPlayers,
					isRecurring: event.isRecurring,
					recurrenceRule: event.recurrenceRule,
					status: event.status as
						| "draft"
						| "published"
						| "cancelled"
						| "completed",
					image: event.image,
				}}
			/>

			{/* Prizes */}
			<EventPrizesManager eventId={event.id} prizes={event.prizes} />

			{/* Winners */}
			<EventWinnersManager
				eventId={event.id}
				winners={event.winners.map((w) => ({
					...w,
					username:
						userMap.get(w.userId) ?? t("userFallback", { id: w.userId }),
				}))}
			/>

			{/* Registrations */}
			<EventRegistrations
				registrations={event.registrations.map((r) => ({
					...r,
					username:
						userMap.get(r.userId) ?? t("userFallback", { id: r.userId }),
				}))}
			/>
		</div>
	);
}
