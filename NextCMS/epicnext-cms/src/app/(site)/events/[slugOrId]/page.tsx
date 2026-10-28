import { and, asc, count, eq, inArray } from "drizzle-orm";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "@/components/link";
import { ContentCard, EmptyState } from "@/components/public/ui";
import { auth } from "@/lib/auth";
import {
	db,
	User,
	WebsiteEvent,
	WebsiteEventPrize,
	WebsiteEventRegistration,
	WebsiteEventType,
	WebsiteEventWinner,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { EventRegisterButton } from "./event-register-button";

function parseEventId(slugOrId: string): number | null {
	if (/^\d+$/.test(slugOrId)) return Number.parseInt(slugOrId, 10);
	const match = slugOrId.match(/-(\d+)$/);
	if (match) return Number.parseInt(match[1], 10);
	return null;
}

export default async function EventDetailPage({
	params,
}: {
	params: Promise<{ slugOrId: string }>;
}) {
	const { slugOrId } = await params;
	const eventId = parseEventId(slugOrId);
	if (eventId == null || !Number.isFinite(eventId)) notFound();

	const t = await getTranslations("pages.events");
	const session = await auth();
	const userId = Number(session?.user?.id);

	const [eventRow] = await db
		.select({
			id: WebsiteEvent.id,
			title: WebsiteEvent.title,
			description: WebsiteEvent.description,
			status: WebsiteEvent.status,
			image: WebsiteEvent.image,
			startsAt: WebsiteEvent.startsAt,
			endsAt: WebsiteEvent.endsAt,
			maxPlayers: WebsiteEvent.maxPlayers,
			typeId: WebsiteEvent.typeId,
			typeName: WebsiteEventType.name,
			typeColor: WebsiteEventType.color,
			typeSlug: WebsiteEventType.slug,
		})
		.from(WebsiteEvent)
		.innerJoin(WebsiteEventType, eq(WebsiteEvent.typeId, WebsiteEventType.id))
		.where(eq(WebsiteEvent.id, eventId))
		.limit(1)
		.catch(() => []);

	if (
		!eventRow ||
		(eventRow.status !== "published" && eventRow.status !== "completed")
	) {
		notFound();
	}

	const [prizes, winners, regCountRows] = await Promise.all([
		db
			.select()
			.from(WebsiteEventPrize)
			.where(eq(WebsiteEventPrize.eventId, eventRow.id))
			.orderBy(asc(WebsiteEventPrize.position))
			.catch(() => []),
		db
			.select()
			.from(WebsiteEventWinner)
			.where(eq(WebsiteEventWinner.eventId, eventRow.id))
			.orderBy(asc(WebsiteEventWinner.position))
			.catch(() => []),
		db
			.select({ value: count() })
			.from(WebsiteEventRegistration)
			.where(eq(WebsiteEventRegistration.eventId, eventRow.id))
			.catch(() => [{ value: 0 }]),
	]);

	const event = {
		...eventRow,
		type: {
			name: eventRow.typeName,
			color: eventRow.typeColor,
			slug: eventRow.typeSlug,
		},
		prizes,
		winners,
		_count: { registrations: Number(regCountRows[0]?.value ?? 0) },
	};

	const alreadyRegistered =
		Number.isInteger(userId) && userId > 0
			? Boolean(
					(
						await db
							.select({ id: WebsiteEventRegistration.id })
							.from(WebsiteEventRegistration)
							.where(
								and(
									eq(WebsiteEventRegistration.eventId, event.id),
									eq(WebsiteEventRegistration.userId, userId),
								),
							)
							.limit(1)
							.catch(() => [])
					)[0],
				)
			: false;

	const winnerIds = event.winners.map((w) => w.userId);
	const winnerUsers =
		winnerIds.length > 0
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, winnerIds))
					.catch(() => [])
			: [];
	const winnerName = new Map(winnerUsers.map((u) => [u.id, u.username]));

	const isFull =
		event.maxPlayers != null && event._count.registrations >= event.maxPlayers;
	const hasEnded =
		event.status === "completed" ||
		(event.endsAt != null && event.endsAt.getTime() < Date.now());
	const canRegister =
		event.status === "published" && !hasEnded && !isFull && !alreadyRegistered;

	let disabledReason: string | undefined;
	if (!session?.user) disabledReason = t("loginToRegister");
	else if (alreadyRegistered) disabledReason = t("alreadyRegistered");
	else if (hasEnded) disabledReason = t("eventEnded");
	else if (isFull) disabledReason = t("eventFull");

	return (
		<section className="page-grid">
			<p className="muted" style={{ margin: 0 }}>
				<Link href="/events">{t("back")}</Link>
			</p>

			{event.image ? (
				<div
					style={{
						position: "relative",
						width: "100%",
						aspectRatio: "21/9",
						borderRadius: "0.75rem",
						overflow: "hidden",
					}}
				>
					<Image
						src={event.image}
						alt=""
						fill
						style={{ objectFit: "cover" }}
						unoptimized
						priority
					/>
				</div>
			) : null}

			<ContentCard
				icon="📅"
				title={event.title}
				subtitle={`${event.type.name} · ${formatDate(event.startsAt, "datetime", "")}`}
			>
				<div style={{ display: "grid", gap: "0.75rem" }}>
					<p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
						{event.description}
					</p>
					<table style={{ width: "100%" }}>
						<tbody>
							<tr>
								<th style={{ width: 140, textAlign: "left" }}>{t("when")}</th>
								<td>
									{formatDate(event.startsAt, "datetime", "")}
									{event.endsAt
										? ` — ${formatDate(event.endsAt, "datetime", "")}`
										: ""}
								</td>
							</tr>
							<tr>
								<th style={{ textAlign: "left" }}>{t("status")}</th>
								<td>
									{event.status === "completed"
										? t("statusCompleted")
										: t("statusPublished")}
								</td>
							</tr>
							<tr>
								<th style={{ textAlign: "left" }}>{t("registrations")}</th>
								<td>
									{event.maxPlayers != null
										? t("spots", {
												count: event._count.registrations,
												max: event.maxPlayers,
											})
										: t("registered", {
												count: event._count.registrations,
											})}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</ContentCard>

			<ContentCard
				icon="✍️"
				title={t("registerTitle")}
				subtitle={t("registerSubtitle")}
			>
				{session?.user && canRegister ? (
					<EventRegisterButton eventId={event.id} />
				) : (
					<EmptyState icon={session?.user ? "ℹ️" : "🔒"}>
						{disabledReason ?? t("cannotRegister")}
					</EmptyState>
				)}
			</ContentCard>

			{event.prizes.length > 0 ? (
				<ContentCard icon="🎁" title={t("prizesTitle")}>
					<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
						{event.prizes.map((prize) => (
							<li key={prize.id} style={{ marginBottom: "0.35rem" }}>
								<strong>#{prize.position}</strong>
								{prize.description
									? ` — ${prize.description}`
									: ` — ${prize.prizeType}`}
								{prize.credits > 0 ? ` · ${prize.credits} credits` : ""}
								{prize.pixels > 0 ? ` · ${prize.pixels} pixels` : ""}
								{prize.points > 0 ? ` · ${prize.points} points` : ""}
								{prize.badgeCode ? ` · badge ${prize.badgeCode}` : ""}
							</li>
						))}
					</ul>
				</ContentCard>
			) : null}

			{event.winners.length > 0 ? (
				<ContentCard icon="🏆" title={t("winnersTitle")}>
					<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
						{event.winners.map((w) => (
							<li key={w.id}>
								#{w.position} —{" "}
								{winnerName.get(w.userId) ?? t("unknownUser", { id: w.userId })}
							</li>
						))}
					</ul>
				</ContentCard>
			) : null}
		</section>
	);
}
