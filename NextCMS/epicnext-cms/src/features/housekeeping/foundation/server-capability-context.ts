import { cache } from "react";
import { getAdminContext } from "@/lib/permissions";
import { createHousekeepingCapabilityContext } from "./capability-context";

export const getHousekeepingCapabilityContext = cache(async () => {
	const { session, permissions } = await getAdminContext();

	return createHousekeepingCapabilityContext(
		{
			id: session.user.id,
			username: session.user.username,
			rank: session.user.rank,
		},
		permissions,
	);
});
