import "server-only";

import { count, eq, ne } from "drizzle-orm";
import { db, WebsiteHelpCenterTickets, WebsiteTicket } from "@/lib/db";

/** Open-queue sizes for dual ticket products (CMS desk vs help-center). */
export async function fetchTicketQueueOpenCounts(): Promise<{
	cmsOpen: number;
	helpOpen: number;
}> {
	const [cmsOpen, helpOpen] = await Promise.all([
		db
			.select({ total: count() })
			.from(WebsiteTicket)
			.where(ne(WebsiteTicket.status, "closed"))
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
		db
			.select({ total: count() })
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.open, true))
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
	]);
	return { cmsOpen, helpOpen };
}
