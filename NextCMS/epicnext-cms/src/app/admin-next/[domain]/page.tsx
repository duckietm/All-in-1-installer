import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HousekeepingPageShell } from "@/features/housekeeping/foundation/page/housekeeping-page-shell";
import { HousekeepingPageState } from "@/features/housekeeping/foundation/page/housekeeping-page-state";
import { createHousekeepingRegistry } from "@/features/housekeeping/foundation/registry";
import { HOUSEKEEPING_MANIFESTS } from "@/features/housekeeping/manifests";

const MESSAGE_PREFIX = "pages.housekeeping.";

function namespaceKey(key: string): string {
	if (!key.startsWith(MESSAGE_PREFIX)) {
		throw new Error(`invalid housekeeping message key: ${key}`);
	}

	return key.slice(MESSAGE_PREFIX.length);
}

export default async function AdminNextDomainPage({
	params,
}: {
	params: Promise<{ domain: string }>;
}) {
	const { domain } = await params;
	const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);
	const activeDomain = registry.domains.find((entry) => entry.id === domain);

	if (!activeDomain) notFound();

	const translate = await getTranslations("pages.housekeeping");

	return (
		<HousekeepingPageShell
			title={translate(namespaceKey(activeDomain.labelKey) as never)}
			description={translate(
				namespaceKey(activeDomain.descriptionKey) as never,
			)}
		>
			<HousekeepingPageState
				state="empty"
				title={translate("states.empty.title")}
				description={translate("states.empty.description")}
			/>
		</HousekeepingPageShell>
	);
}
