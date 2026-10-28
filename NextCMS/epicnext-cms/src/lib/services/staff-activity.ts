import { headers } from "next/headers";
import { resolveClientIp, UNKNOWN_CLIENT_IP } from "@/lib/client-ip";
import { db, StaffActivities } from "@/lib/db";

/**
 * Append a staff-action audit entry (AtomCMS StaffActivity). Never throws —
 * logging must not block the action it records.
 */
export async function logStaffActivity(opts: {
	staffId: number;
	action: string;
	description: string;
	targetType?: string;
	targetId?: number;
}): Promise<void> {
	try {
		let ip = UNKNOWN_CLIENT_IP;
		try {
			ip = resolveClientIp(await headers());
		} catch {
			// Some background actions have no request context.
		}
		await db.insert(StaffActivities).values({
			userId: BigInt(opts.staffId),
			action: opts.action.slice(0, 50),
			description: opts.description,
			targetType: opts.targetType ?? null,
			targetId: opts.targetId != null ? BigInt(opts.targetId) : null,
			ipAddress: ip,
			createdAt: new Date(),
		});
	} catch {
		// swallow — audit logging is best-effort
	}
}
