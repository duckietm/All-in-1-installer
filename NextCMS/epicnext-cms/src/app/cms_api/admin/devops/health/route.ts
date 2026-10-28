import { NextResponse } from "next/server";
import { fetchOpsHealth } from "@/lib/admin/ops-health";
import { withAdmin } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";

export const GET = withAdmin({ permission: PERMS.DEVOPS_VIEW }, async () => {
	try {
		const health = await fetchOpsHealth();

		return NextResponse.json({
			database: health.dbOk,
			dbLatency: health.dbLatencyMs,
			redis: health.redisOk,
			emulator: health.emulatorOk,
			onlineUsers: health.onlineUsers,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		logger.error("Health check failed", { err });
		return NextResponse.json(
			{
				database: false,
				dbLatency: null,
				redis: false,
				emulator: false,
				onlineUsers: 0,
				timestamp: new Date().toISOString(),
				error: "Health check partially failed",
			},
			{ status: 503 },
		);
	}
});
