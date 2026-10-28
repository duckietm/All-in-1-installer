import { getLocale } from "next-intl/server";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { readCmsTranslation } from "@/lib/cms-translations";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { TranslationsClient } from "../translations-client";

export default async function CmsTranslationsPage() {
	const [{ session, permissions }, locale, entries] = await Promise.all([
		getAdminContext(),
		getLocale(),
		Promise.all(
			SUPPORTED_LOCALES.map(
				async (locale) => [locale, await readCmsTranslation(locale)] as const,
			),
		),
	]);
	return (
		<TranslationsClient
			snapshots={Object.fromEntries(entries)}
			initialLocale={locale}
			canEdit={canAccess(permissions, PERMS.SETTINGS_EDIT, session.user.rank)}
		/>
	);
}
