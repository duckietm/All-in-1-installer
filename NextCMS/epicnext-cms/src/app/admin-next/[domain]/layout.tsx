import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { satisfiesCapability } from "@/features/housekeeping/foundation/capability-context";
import { buildHousekeepingNavigation } from "@/features/housekeeping/foundation/navigation";
import { createHousekeepingRegistry } from "@/features/housekeeping/foundation/registry";
import { getHousekeepingCapabilityContext } from "@/features/housekeeping/foundation/server-capability-context";
import { HousekeepingShell } from "@/features/housekeeping/foundation/shell/housekeeping-shell";
import { HOUSEKEEPING_MANIFESTS } from "@/features/housekeeping/manifests";

const MESSAGE_PREFIX = "pages.housekeeping.";

function namespaceKey(key: string): string {
	if (!key.startsWith(MESSAGE_PREFIX)) {
		throw new Error(`invalid housekeeping message key: ${key}`);
	}

	return key.slice(MESSAGE_PREFIX.length);
}

export default async function AdminNextDomainLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ domain: string }>;
}) {
	const { domain } = await params;
	const registry = createHousekeepingRegistry(HOUSEKEEPING_MANIFESTS);
	const activeDomain = registry.domains.find((entry) => entry.id === domain);

	if (!activeDomain) notFound();

	const context = await getHousekeepingCapabilityContext();
	if (!satisfiesCapability(context, activeDomain.capability)) notFound();

	const translate = await getTranslations("pages.housekeeping");
	const navigation = buildHousekeepingNavigation(registry, context, (key) =>
		translate(namespaceKey(key) as never),
	);

	return (
		<HousekeepingShell
			actor={context.actor}
			activeDomainId={activeDomain.id}
			domains={navigation}
			labels={{
				skipToContent: translate("navigation.skipToContent"),
				primaryNavigation: translate("navigation.primary"),
				contextualNavigation: translate("navigation.contextual"),
				command: translate("preview.commandDisabled"),
				preview: translate("preview.badge"),
				backToSite: translate("preview.backToSite"),
			}}
		>
			{children}
		</HousekeepingShell>
	);
}
