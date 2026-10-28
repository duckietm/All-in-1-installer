/**
 * Validate a post-login destination taken from the query string.
 *
 * The value ends up in `window.location.href`, so an unvalidated one turns the
 * sign-in form into an open redirect. Only same-site absolute paths pass:
 * `//host` and `/\host` are cross-origin in every browser, and anything without
 * a leading slash is not a path at all. Control characters are refused too:
 * browsers strip them, which would turn `/\t/host` into `//host`.
 */
export function safeRedirectPath(
	raw: string | null | undefined,
	fallback = "/me",
): string {
	if (!raw) return fallback;
	if (!raw.startsWith("/")) return fallback;
	if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
	// Browsers drop tabs and line breaks while parsing a URL, so "/\t/evil.com" becomes
	// "//evil.com": no control characters or backslashes at all.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
	if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
	return raw;
}
