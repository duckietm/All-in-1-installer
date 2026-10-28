import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { issueSsoTicket } from "@/lib/auth/sso-ticket";
import { resolveClientIp } from "@/lib/client-ip";
import { resolveHotelName } from "@/lib/hotel-name";
import { cachedOnlineCount } from "@/lib/services/public-counters";

import { siteSettings } from "@/lib/services/site-settings";
import { ClientView } from "./client-view";

export default async function ClientPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");

	const userId = Number(session.user.id);

	const [hotelName, clientUrl] = await Promise.all([
		resolveHotelName(),
		siteSettings.get("nitro_client_url", ""),
	]);

	const ip = resolveClientIp(await headers());

	// Ticket write and online count run in parallel — the client page should
	// render as fast as possible since the player is waiting for the game.
	const [ticket, onlineCount] = await Promise.all([
		issueSsoTicket(userId, hotelName, ip),
		cachedOnlineCount().catch(() => 0),
	]);

	return (
		<ClientView
			ticket={ticket}
			clientUrl={clientUrl || "/nitro-client/"}
			hotelName={hotelName}
			initialOnline={onlineCount}
		/>
	);
}
