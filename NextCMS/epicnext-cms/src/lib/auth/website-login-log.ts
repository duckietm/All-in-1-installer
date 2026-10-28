import { db, WebsiteLoginLogs } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Records a successful login for the user's "session logs" page. Best-effort:
 * always produces a real User-Agent header value, never blocks sign-in.
 */
export async function recordWebsiteLogin(
	userId: number,
	ip: string,
): Promise<void> {
	try {
		const { headers } = await import("next/headers");
		const ua = (await headers()).get("user-agent")?.slice(0, 512) ?? null;
		await db.insert(WebsiteLoginLogs).values({
			userId,
			ip,
			userAgent: ua,
			createdAt: new Date(),
		});
	} catch {
		logger.warn("Failed to record login log for user", { userId });
	}
}
