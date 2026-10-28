/**
 * Build a Content-Security-Policy value.
 * Scripts/styles: per-request nonce for Next.js and ThemeVars inline tags.
 * style-src-attr keeps 'unsafe-inline' so React `style={{…}}` attributes work.
 */
export function buildContentSecurityPolicy(nonce: string): string {
	const isDev = process.env.NODE_ENV === "development";
	const scriptSrc = [
		"'self'",
		`'nonce-${nonce}'`,
		"https://challenges.cloudflare.com",
		"https://www.google.com/recaptcha/",
		"https://www.gstatic.com/recaptcha/",
		"https://static.cloudflareinsights.com",
		...(isDev ? ["'unsafe-eval'"] : []),
	].join(" ");

	const styleSrc = [
		"'self'",
		"'unsafe-inline'",
		"https://fonts.googleapis.com",
	].join(" ");

	return [
		"default-src 'self'",
		`script-src ${scriptSrc}`,
		`style-src ${styleSrc}`,
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"frame-src 'self' https://challenges.cloudflare.com https://www.google.com/recaptcha/",
		// Clickjacking defence that also covers the `frame-ancestors`-aware
		// browsers X-Frame-Options cannot reach. `upgrade-insecure-requests` is
		// production-only: over plain-HTTP localhost it would rewrite same-origin
		// asset URLs to https and break the dev server.
		"frame-ancestors 'none'",
		"connect-src 'self' https: wss:",
		"font-src 'self' data: https://fonts.gstatic.com",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		...(isDev ? [] : ["upgrade-insecure-requests"]),
	].join("; ");
}

export function createCspNonce(): string {
	return Buffer.from(crypto.randomUUID()).toString("base64");
}
