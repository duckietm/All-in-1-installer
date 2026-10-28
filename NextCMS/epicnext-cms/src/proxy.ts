import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { env } from "@/env";
import { buildContentSecurityPolicy, createCspNonce } from "@/lib/csp";
import { isSuspiciousPath } from "@/lib/ddos";
import { ddosReject, enforceDdosRateLimit } from "@/lib/ddos-guard";
import {
	isCacheableAssetPath,
	isEdgeCacheablePublicPath,
	shouldRedirectAdminRequest,
} from "@/lib/proxy-access";

const SECURITY_HEADERS: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"X-XSS-Protection": "0",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

export const proxy = async (req: import("next/server").NextRequest) => {
	const pathname = req.nextUrl.pathname;

	// Drop scanner probes immediately before performing any rate-limit or DB operations.
	if (isSuspiciousPath(pathname)) {
		return ddosReject(403);
	}

	// Server actions carry an opaque action id in this header. A malformed or
	// trivially short id (e.g. "x" sent by bots) can never resolve to a real
	// action; rejecting it here avoids the expensive lookup/render path.
	const nextAction = req.headers.get("next-action");
	if (nextAction && !/^[A-Za-z0-9_-]{8,}$/.test(nextAction)) {
		return new NextResponse(null, { status: 400 });
	}

	const decision = await enforceDdosRateLimit(req);
	if (decision.outcome === "block") {
		return ddosReject(429, decision.retryAfterSeconds);
	}

	// Only /admin needs a real session token for the redirect guard; skipping
	// JWT decoding on every other request keeps the proxy cheap under load.
	const adminPath = pathname === "/admin" || pathname.startsWith("/admin/");
	const token = adminPath
		? await getToken({
				req,
				secret: env.AUTH_SECRET,
				secureCookie: true,
			})
		: null;

	if (shouldRedirectAdminRequest(pathname, token)) {
		// Carry the destination along so the sign-in form can send the visitor
		// back to the page they asked for instead of dumping them on /me.
		const login = new URL("/login", req.url);
		login.searchParams.set("from", `${pathname}${req.nextUrl.search}`);
		return NextResponse.redirect(login);
	}

	const nonce = createCspNonce();
	const csp = buildContentSecurityPolicy(nonce);

	const headers = new Headers(req.headers);
	headers.set("x-pathname", pathname);
	headers.set("x-nonce", nonce);
	// Next derives its render nonce from the *request* `content-security-policy`
	// header, not from `x-nonce`, so the policy has to travel on the request as
	// well — otherwise every inline bootstrap/flight script Next emits ships
	// without a nonce and is blocked by the very CSP we are building here.
	headers.set("Content-Security-Policy", csp);

	// A client may supply this legacy derived header; no consumer should trust it.
	headers.delete("x-real-client-ip");

	const response = NextResponse.next({ request: { headers } });

	// HTML is never cached (browser/CDN/edge) so that after a deploy the page
	// always references the current build's chunks. Static assets are
	// content-hashed + immutable and can be cached aggressively; a stale HTML
	// document would reference chunk URLs that no longer exist after a rebuild.
	// Rendered avatars and uploaded media are immutable per key and already
	// carry their own long-lived Cache-Control, so they keep it here.
	if (isCacheableAssetPath(pathname)) {
		// Keep the asset headers as-is.
	} else if (
		isEdgeCacheablePublicPath(pathname) &&
		!req.cookies.get("authjs.session-token") &&
		!req.cookies.get("__Secure-authjs.session-token") &&
		!req.nextUrl.searchParams.has("from")
	) {
		// Anonymous, low-variance public pages get a short shared cache with
		// stale-while-revalidate, so a burst of visitors triggers one render
		// instead of one per visitor. Anything session-dependent still falls
		// through to the private header below.
		response.headers.set(
			"Cache-Control",
			"public, max-age=0, s-maxage=30, stale-while-revalidate=300",
		);
	} else {
		response.headers.set(
			"Cache-Control",
			"private, no-cache, no-store, max-age=0, must-revalidate",
		);
	}

	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	response.headers.set("Content-Security-Policy", csp);

	return response;
};

export const config = {
	// `/imaging` and `/images` are excluded: they are raw image responses that
	// carry their own long-lived Cache-Control and must not be rewritten by the
	// HTML/asset cache logic. In production the edge proxy also fronts
	// `/imaging` straight to the renderer, so the CMS route never sees that
	// traffic; `/cms_api/imaging/*` (avatars, badges) is NOT excluded and therefore
	// still passes through the anti-DDoS gate and keeps its asset headers.
	matcher: [
		"/((?!_next/static|_next/image|assets|favicon.ico|swf|nitro-assets|imaging|images).*)",
	],
};
