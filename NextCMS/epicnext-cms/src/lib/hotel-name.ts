import "server-only";

import { env } from "@/env";

/**
 * The public hotel name is read directly from the required HOTEL_NAME env var.
 * There is no CMS override or hardcoded preset — the site must be configured,
 * otherwise HOTEL_NAME fails validation at startup.
 */
export async function resolveHotelName(): Promise<string> {
	return env.HOTEL_NAME;
}
