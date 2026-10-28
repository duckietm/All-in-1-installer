import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/env";
import { isHousekeepingPreviewEnabled } from "@/features/housekeeping/foundation/preview-gate";
import { getHousekeepingCapabilityContext } from "@/features/housekeeping/foundation/server-capability-context";
import { PERMS } from "@/lib/permission-slugs";

export default async function AdminNextLayout({
	children,
}: {
	children: ReactNode;
}) {
	const hasProductionAccess =
		env.NODE_ENV === "production" && env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED
			? (await getHousekeepingCapabilityContext()).has(
					PERMS.HOUSEKEEPING_PREVIEW_ACCESS,
				)
			: false;

	if (
		!isHousekeepingPreviewEnabled({
			nodeEnv: env.NODE_ENV,
			flag: env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED,
			hasProductionAccess,
		})
	) {
		notFound();
	}

	// Staff tree: re-install the full catalogue the root layout scopes down to
	// the public subset (nested providers replace the parent set).
	const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

	return (
		<NextIntlClientProvider locale={locale} messages={messages}>
			{children}
		</NextIntlClientProvider>
	);
}
