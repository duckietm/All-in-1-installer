import "server-only";
import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";
import {
	db,
	WebsiteEvent,
	WebsiteEventRegistration,
	WebsiteEventType,
} from "@/lib/db";

export async function loadPublicEvents(
	options: {
		status?: string;
		week?: string;
		page?: number;
		mine?: boolean;
		userId?: number;
		now?: Date;
	} = {},
) {
	const now = options.now ?? new Date();
	const status = ["upcoming", "ongoing", "completed"].includes(
		options.status ?? "",
	)
		? options.status
		: "all";
	const weekDate = /^\d{4}-\d{2}-\d{2}$/.test(options.week ?? "")
		? new Date(`${options.week}T00:00:00Z`)
		: null;
	const week =
		weekDate &&
		Number.isFinite(weekDate.getTime()) &&
		weekDate.toISOString().slice(0, 10) === options.week
			? weekDate
			: null;
	const weekEnd = week ? new Date(week.getTime() + 7 * 86400000) : null;
	const completed = or(
		eq(WebsiteEvent.status, "completed"),
		lte(WebsiteEvent.endsAt, now),
	);
	const where = and(
		inArray(WebsiteEvent.status, ["published", "completed"]),
		status === "completed"
			? completed
			: status === "upcoming"
				? and(
						eq(WebsiteEvent.status, "published"),
						gt(WebsiteEvent.startsAt, now),
						or(isNull(WebsiteEvent.endsAt), gt(WebsiteEvent.endsAt, now)),
					)
				: status === "ongoing"
					? and(
							eq(WebsiteEvent.status, "published"),
							lte(WebsiteEvent.startsAt, now),
							or(isNull(WebsiteEvent.endsAt), gt(WebsiteEvent.endsAt, now)),
						)
					: undefined,
		week && weekEnd
			? and(
					gte(WebsiteEvent.startsAt, week),
					lt(WebsiteEvent.startsAt, weekEnd),
				)
			: undefined,
		options.mine
			? options.userId
				? exists(
						db
							.select({ id: WebsiteEventRegistration.id })
							.from(WebsiteEventRegistration)
							.where(
								and(
									eq(WebsiteEventRegistration.eventId, WebsiteEvent.id),
									eq(WebsiteEventRegistration.userId, options.userId),
								),
							),
					)
				: sql`1 = 0`
			: undefined,
	);
	const totals = await db
		.select({ value: count() })
		.from(WebsiteEvent)
		.innerJoin(WebsiteEventType, eq(WebsiteEvent.typeId, WebsiteEventType.id))
		.where(where);
	const total = Number(totals[0]?.value ?? 0);
	const lastPage = Math.max(1, Math.ceil(total / 24));
	const page = Math.min(
		lastPage,
		Number.isFinite(options.page)
			? Math.max(1, Math.trunc(options.page ?? 1))
			: 1,
	);
	const rows = await db
		.select({
			id: WebsiteEvent.id,
			title: WebsiteEvent.title,
			description: WebsiteEvent.description,
			status: WebsiteEvent.status,
			image: WebsiteEvent.image,
			startsAt: WebsiteEvent.startsAt,
			endsAt: WebsiteEvent.endsAt,
			maxPlayers: WebsiteEvent.maxPlayers,
			typeName: WebsiteEventType.name,
			typeColor: WebsiteEventType.color,
			typeSlug: WebsiteEventType.slug,
		})
		.from(WebsiteEvent)
		.innerJoin(WebsiteEventType, eq(WebsiteEvent.typeId, WebsiteEventType.id))
		.where(where)
		.orderBy(
			status === "completed"
				? desc(WebsiteEvent.startsAt)
				: asc(WebsiteEvent.startsAt),
			asc(WebsiteEvent.id),
		)
		.limit(24)
		.offset((page - 1) * 24);
	const ids = rows.map((row) => row.id);
	const counts = ids.length
		? await db
				.select({ eventId: WebsiteEventRegistration.eventId, value: count() })
				.from(WebsiteEventRegistration)
				.where(inArray(WebsiteEventRegistration.eventId, ids))
				.groupBy(WebsiteEventRegistration.eventId)
		: [];
	const own =
		ids.length && options.userId
			? await db
					.select({ eventId: WebsiteEventRegistration.eventId })
					.from(WebsiteEventRegistration)
					.where(
						and(
							inArray(WebsiteEventRegistration.eventId, ids),
							eq(WebsiteEventRegistration.userId, options.userId),
						),
					)
			: [];
	const events = rows.map((row) => ({
		...row,
		phase:
			row.status === "completed" || (row.endsAt && row.endsAt <= now)
				? "completed"
				: row.startsAt > now
					? "upcoming"
					: "ongoing",
		registered: own.some((r) => r.eventId === row.id),
		type: { name: row.typeName, color: row.typeColor, slug: row.typeSlug },
		_count: {
			registrations: Number(
				counts.find((r) => r.eventId === row.id)?.value ?? 0,
			),
		},
	}));
	return {
		events,
		total,
		page,
		lastPage,
		status,
		week: week?.toISOString().slice(0, 10) ?? "",
	};
}
