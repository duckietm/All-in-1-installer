"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	db,
	WebsiteEvent,
	WebsiteEventPrize,
	WebsiteEventRegistration,
	WebsiteEventType,
	WebsiteEventWinner,
} from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { publicationIssues } from "@/lib/publication-preflight";
import { adminAction, authAction } from "@/lib/safe-action";
import { ActionError, actionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { notify } from "@/lib/services/webhook";
import {
	createEventSchema,
	eventPrizeSchema,
	eventTypeSchema,
	eventWinnerSchema,
	registerForEventSchema,
	updateEventSchema,
} from "@/lib/validators/event";

// ── Event Types ─────────────────────────────────────────────────────

export const createEventType = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: eventTypeSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsiteEventType).values(ctx.data);
		const eventTypeId = Number(result.insertId);
		logAudit({
			userId: ctx.session.user.id,
			action: "event_type_create",
			target: "WebsiteEventType",
			targetId: eventTypeId,
			after: { name: ctx.data.name },
		});
		return actionOk({ id: eventTypeId });
	},
);

const updateEventTypeInput = eventTypeSchema.partial().extend({
	id: z.coerce.number().int().positive(),
});

export const updateEventType = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: updateEventTypeInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		const [existing] = await db
			.select({ id: WebsiteEventType.id, name: WebsiteEventType.name })
			.from(WebsiteEventType)
			.where(eq(WebsiteEventType.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Event type not found");

		await db
			.update(WebsiteEventType)
			.set(data)
			.where(eq(WebsiteEventType.id, id));
		logAudit({
			userId: ctx.session.user.id,
			action: "event_type_update",
			target: "WebsiteEventType",
			targetId: id,
			before: { name: existing.name },
			after: data,
		});
		return actionOk({ id });
	},
);

const deleteEventTypeInput = z.object({
	id: z.coerce.number().int().positive(),
});

export const deleteEventType = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: deleteEventTypeInput },
	async (ctx) => {
		const [existing] = await db
			.select({ id: WebsiteEventType.id, name: WebsiteEventType.name })
			.from(WebsiteEventType)
			.where(eq(WebsiteEventType.id, ctx.data.id))
			.limit(1);
		if (!existing) throw new ActionError("Event type not found");

		await db
			.delete(WebsiteEventType)
			.where(eq(WebsiteEventType.id, ctx.data.id));
		logAudit({
			userId: ctx.session.user.id,
			action: "event_type_delete",
			target: "WebsiteEventType",
			targetId: ctx.data.id,
			before: { name: existing.name },
		});
		return actionOk();
	},
);

// ── Events ──────────────────────────────────────────────────────────

export const createEvent = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: createEventSchema },
	async (ctx) => {
		const now = new Date();
		if (
			ctx.data.status === "published" &&
			publicationIssues({ kind: "event", ...ctx.data }).some(
				(issue) => issue.severity === "error",
			)
		)
			throw new ActionError(
				"Check the event image and schedule before publishing",
			);
		const [result] = await db.insert(WebsiteEvent).values({
			...ctx.data,
			hostUserId: Number(ctx.session.user.id),
			updatedAt: now,
		});
		const eventId = Number(result.insertId);
		logAudit({
			userId: ctx.session.user.id,
			action: "event_create",
			target: "WebsiteEvent",
			targetId: eventId,
			after: { title: ctx.data.title },
		});
		notify({
			action: "event_create",
			actor: ctx.session.user.username,
			target: ctx.data.title,
		});
		return actionOk({ id: eventId });
	},
);

const updateEventInput = updateEventSchema.extend({
	id: z.coerce.number().int().positive(),
});

export const updateEvent = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: updateEventInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		const [existing] = await db
			.select({
				id: WebsiteEvent.id,
				title: WebsiteEvent.title,
				status: WebsiteEvent.status,
				image: WebsiteEvent.image,
				startsAt: WebsiteEvent.startsAt,
				endsAt: WebsiteEvent.endsAt,
			})
			.from(WebsiteEvent)
			.where(eq(WebsiteEvent.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Event not found");
		if (
			(data.status ?? existing.status) === "published" &&
			publicationIssues({
				kind: "event",
				image: data.image === undefined ? existing.image : data.image,
				startsAt:
					data.startsAt === undefined ? existing.startsAt : data.startsAt,
				endsAt: data.endsAt === undefined ? existing.endsAt : data.endsAt,
			}).some((issue) => issue.severity === "error")
		)
			throw new ActionError(
				"Check the event image and schedule before publishing",
			);

		await db
			.update(WebsiteEvent)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(WebsiteEvent.id, id));
		logAudit({
			userId: ctx.session.user.id,
			action: "event_update",
			target: "WebsiteEvent",
			targetId: id,
			before: { title: existing.title, status: existing.status },
			after: data,
		});
		notify({
			action: "event_update",
			actor: ctx.session.user.username,
			target: data.title ?? existing.title,
		});
		return actionOk({ id });
	},
);

const deleteEventInput = z.object({
	id: z.coerce.number().int().positive(),
});

export const deleteEvent = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: deleteEventInput },
	async (ctx) => {
		const [existing] = await db
			.select({ id: WebsiteEvent.id, title: WebsiteEvent.title })
			.from(WebsiteEvent)
			.where(eq(WebsiteEvent.id, ctx.data.id))
			.limit(1);
		if (!existing) throw new ActionError("Event not found");

		await db.delete(WebsiteEvent).where(eq(WebsiteEvent.id, ctx.data.id));
		logAudit({
			userId: ctx.session.user.id,
			action: "event_delete",
			target: "WebsiteEvent",
			targetId: ctx.data.id,
			before: { title: existing.title },
		});
		return actionOk();
	},
);

// ── Prizes ──────────────────────────────────────────────────────────

export const addEventPrize = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: eventPrizeSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsiteEventPrize).values(ctx.data);
		return actionOk({ id: Number(result.insertId) });
	},
);

const deletePrizeInput = z.object({ id: z.coerce.number().int().positive() });

export const deleteEventPrize = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: deletePrizeInput },
	async (ctx) => {
		await db
			.delete(WebsiteEventPrize)
			.where(eq(WebsiteEventPrize.id, ctx.data.id));
		return actionOk();
	},
);

// ── Winners ─────────────────────────────────────────────────────────

export const addEventWinner = adminAction(
	{ permission: PERMS.EVENTS_EDIT, schema: eventWinnerSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsiteEventWinner).values(ctx.data);
		const winnerId = Number(result.insertId);
		logAudit({
			userId: ctx.session.user.id,
			action: "event_winner_add",
			target: "WebsiteEventWinner",
			targetId: winnerId,
			after: {
				eventId: ctx.data.eventId,
				userId: ctx.data.userId,
				position: ctx.data.position,
			},
		});
		return actionOk({ id: winnerId });
	},
);

// ── Public site: register ───────────────────────────────────────────

export const registerForEvent = authAction(
	{
		schema: registerForEventSchema,
		rateLimitKey: "event-register",
		rateLimitMax: 10,
		rateLimitWindowMs: 60_000,
	},
	async (ctx) => {
		const userId = Number(ctx.session.user.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			return actionError("Unauthorized");
		}

		const [event] = await db
			.select({
				id: WebsiteEvent.id,
				status: WebsiteEvent.status,
				endsAt: WebsiteEvent.endsAt,
				maxPlayers: WebsiteEvent.maxPlayers,
				minRank: WebsiteEventType.minRank,
			})
			.from(WebsiteEvent)
			.innerJoin(WebsiteEventType, eq(WebsiteEvent.typeId, WebsiteEventType.id))
			.where(eq(WebsiteEvent.id, ctx.data.eventId))
			.limit(1);

		if (!event) return actionError("Event not found");
		if (event.status !== "published") {
			return actionError("This event is not open for registration");
		}
		if (event.endsAt && event.endsAt.getTime() < Date.now()) {
			return actionError("This event has already ended");
		}
		if (event.minRank > 0) {
			const rank = Number(ctx.session.user.rank ?? 0);
			if (rank < event.minRank) {
				return actionError("Your rank is too low to join this event");
			}
		}
		if (event.maxPlayers != null) {
			const [regCount] = await db
				.select({ value: count() })
				.from(WebsiteEventRegistration)
				.where(eq(WebsiteEventRegistration.eventId, event.id));
			if ((regCount?.value ?? 0) >= event.maxPlayers) {
				return actionError("This event is full");
			}
		}

		const [existing] = await db
			.select({ id: WebsiteEventRegistration.id })
			.from(WebsiteEventRegistration)
			.where(
				and(
					eq(WebsiteEventRegistration.eventId, event.id),
					eq(WebsiteEventRegistration.userId, userId),
				),
			)
			.limit(1);
		if (existing) return actionError("You are already registered");

		await db.insert(WebsiteEventRegistration).values({
			eventId: event.id,
			userId,
		});

		revalidatePath("/events");
		revalidatePath(`/events/${event.id}`);
		return actionOk({ eventId: event.id });
	},
);
