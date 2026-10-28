import "server-only";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { db, WebsiteEvent, WebsiteEventType } from "@/lib/db";
import { getDashboardEventPhase } from "./dashboard-event-phase";

export async function loadDashboardEvent(now = new Date()) {
	try {
		const rows = await db
			.select({
				id: WebsiteEvent.id,
				title: WebsiteEvent.title,
				status: WebsiteEvent.status,
				startsAt: WebsiteEvent.startsAt,
				endsAt: WebsiteEvent.endsAt,
				typeName: WebsiteEventType.name,
			})
			.from(WebsiteEvent)
			.innerJoin(WebsiteEventType, eq(WebsiteEvent.typeId, WebsiteEventType.id))
			.where(
				and(
					eq(WebsiteEvent.status, "published"),
					or(gt(WebsiteEvent.startsAt, now), gt(WebsiteEvent.endsAt, now)),
				),
			)
			.orderBy(asc(WebsiteEvent.startsAt), asc(WebsiteEvent.id))
			.limit(1);
		const event = rows[0];
		const phase = event ? getDashboardEventPhase(event, now) : null;
		return {
			event: event && phase ? { ...event, phase } : null,
			unavailable: false,
		};
	} catch {
		return { event: null, unavailable: true };
	}
}
