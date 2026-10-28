export type DateFormatVariant =
	| "date"
	| "time"
	| "datetime"
	| "datetime-seconds";

const FALLBACKS: Record<DateFormatVariant, string> = {
	date: "",
	time: "—",
	datetime: "—",
	"datetime-seconds": "—",
};

/**
 * Format a Date for display. Kept as a single shared helper so the various
 * admin/site pages no longer each redefine their own copy.
 *
 * - "date"            → 2026-07-18
 * - "time"            → 18:30
 * - "datetime"        → 2026-07-18 18:30
 * - "datetime-seconds"→ 2026-07-18 18:30:45
 *
 * `fallback` overrides the default em-dash / empty string when the value is
 * null/undefined.
 */
export function formatDate(
	d: Date | null | undefined,
	variant: DateFormatVariant = "datetime",
	fallback?: string,
): string {
	if (!d) return fallback ?? FALLBACKS[variant];
	const iso = d.toISOString();
	switch (variant) {
		case "date":
			return iso.slice(0, 10);
		case "time":
			return iso.slice(11, 16);
		case "datetime-seconds":
			return iso.slice(0, 19).replace("T", " ");
		default:
			return iso.slice(0, 16).replace("T", " ");
	}
}

/**
 * Format a number with grouped thousands. Uses the provided locale or a
 * consistent default for admin pages. Keeps number formatting in one place.
 */
export function formatNumber(n: number, locale: string = "en-US"): string {
	return n.toLocaleString(locale);
}
