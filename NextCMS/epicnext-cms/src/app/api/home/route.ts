import { env } from "@/env";
import { apiJson } from "@/lib/api";
import { logger } from "@/lib/logger";
import { cachedHomePayload } from "@/lib/services/home-payload";

/**
 * GET /api/home — combined landing payload: the latest 4 website_articles and
 * the current online player count (users.online === "1"). Mirrors the queries
 * used by the public pages and the admin dashboard.
 */
export async function GET(_req: Request) {
	try {
		return apiJson(await cachedHomePayload());
	} catch (error) {
		logger.error("Public news query failed", { module: "news", error });
		return apiJson(
			{ articles: [], online: 0, hotelName: env.HOTEL_NAME },
			{ status: 200 },
		);
	}
}
