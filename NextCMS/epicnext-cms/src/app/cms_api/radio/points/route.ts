import { eq, sum } from "drizzle-orm";
import { apiError, apiJson } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import { db, RadioListenerPoints } from "@/lib/db";

// The Bearer-authed user's total radio listener points: the sum of all
// radio_listener_points.points rows for that user_id.

export async function GET(req: Request) {
	const uid = await bearerUserId(req, ["radio:read"]);
	if (!uid) return apiError("Unauthorized", 401);

	try {
		const [agg] = await db
			.select({ points: sum(RadioListenerPoints.points) })
			.from(RadioListenerPoints)
			.where(eq(RadioListenerPoints.userId, BigInt(uid)));

		return apiJson({ points: Number(agg?.points ?? 0) });
	} catch {
		// DB unavailable — report zero rather than a 500.
		return apiJson({ points: 0 }, { status: 200 });
	}
}
