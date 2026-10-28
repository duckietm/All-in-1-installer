export const SUPPORTED_LOCALES = [
	"en",
	"it",
	"nl",
	"de",
	"fr",
	"es",
	"pt",
	"pl",
	"sv",
	"tr",
	"ro",
	"hu",
	"cs",
	"sk",
	"da",
	"no",
	"el",
	"bg",
	"hr",
	"sr",
	"uk",
	"ru",
] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

export function isSupportedLocale(
	value: string | undefined,
): value is AppLocale {
	return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
