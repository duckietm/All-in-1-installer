import {
	type AuthorizationEvent,
	authorizationActivity,
} from "@/lib/admin/authorization-event";
import { logServerError } from "@/lib/server-log";
import { logStaffActivity } from "@/lib/services/staff-activity";

export async function logAuthorizationEvent(
	event: AuthorizationEvent,
): Promise<void> {
	const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await logStaffActivity({
		...authorizationActivity(event),
		description: `${authorizationActivity(event).description}; correlation=${correlationId}`,
	});
	if (event.error)
		logServerError(event.kind, event.error, {
			correlationId,
			userId: event.userId,
			rank: event.rank,
			permission: event.permission ?? null,
			source: event.source,
		});
}
