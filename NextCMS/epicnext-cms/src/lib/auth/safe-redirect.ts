/**
 * Validate a post-login destination taken from the query string.
 *
 * The value ends up in `window.location.href`, so an unvalidated one turns the
 * sign-in form into an open redirect. Only same-site absolute paths pass:
 * `//host` and `/\host` are cross-origin in every browser, and anything without
 * a leading slash is not a path at all.
 */
export function safeRedirectPath(
	raw: string | null | undefined,
	fallback = "/me",
): string {
	if (!raw) return fallback;
	if (!raw.startsWith("/")) return fallback;
	if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
	return raw;
}
