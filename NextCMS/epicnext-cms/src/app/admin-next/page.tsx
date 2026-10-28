import { notFound, redirect } from "next/navigation";
import { satisfiesCapability } from "@/features/housekeeping/foundation/capability-context";
import { createHousekeepingRegistry } from "@/features/housekeeping/foundation/registry";
import { getHousekeepingCapabilityContext } from "@/features/housekeeping/foundation/server-capability-context";
import { HOUSEKEEPING_MANIFESTS } from "@/features/housekeeping/manifests";

export default async function AdminNextPage() {
	const context = await getHousekeepingCapabilityContext();
	const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);
	const firstVisibleDomain = registry.domains.find((domain) =>
		satisfiesCapability(context, domain.capability),
	);

	if (!firstVisibleDomain) notFound();

	redirect(firstVisibleDomain.previewHref);
}
