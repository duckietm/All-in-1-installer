import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { loadCmsMessages } from "@/lib/cms-translations";
import { mergeMessages } from "./merge-messages";

// i18n WITHOUT routing: the locale is chosen by a `NEXT_LOCALE` cookie, then
// the Accept-Language header, and finally English as fallback.
export {
	DEFAULT_LOCALE,
	isSupportedLocale,
	SUPPORTED_LOCALES,
} from "./locales";

import { type AppLocale, DEFAULT_LOCALE, isSupportedLocale } from "./locales";

function detectLocaleFromAcceptLanguage(
	acceptLanguage: string | null,
): AppLocale | null {
	if (!acceptLanguage) return null;
	const locales = acceptLanguage
		.split(",")
		.map((entry) => {
			const [tag, qPart] = entry.split(";");
			const quality = qPart ? parseFloat(qPart.replace("q=", "")) : 1;
			const lang = tag?.trim().split("-")[0] ?? "";
			return { lang, quality };
		})
		.filter((l) => l.lang)
		.sort((a, b) => b.quality - a.quality);

	for (const { lang } of locales) {
		if (isSupportedLocale(lang)) return lang;
	}
	return null;
}

/**
 * The locale's messages over the English ones, kept while both trees are the
 * same objects (loadCmsMessages reuses them until a translation changes), so
 * the whole catalogue is not deep-copied on every request.
 */
const mergedByLocale = new Map<
	string,
	{
		fallback: object;
		messages: object;
		merged: ReturnType<typeof mergeMessages>;
	}
>();
function mergedWithFallback(
	locale: string,
	fallback: Parameters<typeof mergeMessages>[0],
	messages: Parameters<typeof mergeMessages>[1],
) {
	const hit = mergedByLocale.get(locale);
	if (hit && hit.fallback === fallback && hit.messages === messages)
		return hit.merged;
	const merged = mergeMessages(fallback, messages);
	mergedByLocale.set(locale, { fallback, messages, merged });
	return merged;
}

export default getRequestConfig(async () => {
	const store = await cookies();
	const cookieLocale = store.get("NEXT_LOCALE")?.value;

	let locale: AppLocale;
	if (isSupportedLocale(cookieLocale)) {
		locale = cookieLocale;
	} else {
		const headersList = await headers();
		const detected = detectLocaleFromAcceptLanguage(
			headersList.get("Accept-Language"),
		);
		locale = detected ?? DEFAULT_LOCALE;
	}

	const [messages, fallback] = await Promise.all([
		loadCmsMessages(locale),
		loadCmsMessages(DEFAULT_LOCALE),
	]);

	return {
		locale,
		messages: mergedWithFallback(locale, fallback, messages),
		// Never throw on a missing message — use the English value, or a humanised
		// key as a last resort.
		getMessageFallback({
			namespace,
			key,
		}: {
			namespace?: string;
			key: string;
		}) {
			const fromEnglish = [namespace, key]
				.filter(Boolean)
				.join(".")
				.split(".")
				.reduce<unknown>(
					(o, k) =>
						o && typeof o === "object"
							? (o as Record<string, unknown>)[k]
							: undefined,
					fallback,
				);
			if (typeof fromEnglish === "string") return fromEnglish;
			const seg = key.split(".").pop() ?? key;
			return seg
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.replace(/[._-]/g, " ")
				.replace(/\b\w/g, (c) => c.toUpperCase());
		},
		onError() {
			// Swallow MISSING_MESSAGE etc. — getMessageFallback already degrades.
		},
	};
});
