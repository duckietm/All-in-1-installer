import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { resolveClientIp, UNKNOWN_CLIENT_IP } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import type { IpAddress } from "./types";

const CSRF_BYTES = 32;
const CSRF_COOKIE_MAX_AGE = 86400; // 24h
const CSRF_COOKIE_FALLBACK = "csrf-token";
const CSRF_COOKIE_HOST = "__Host-csrf-token";

const CSRF_COOKIE_NAMES = [CSRF_COOKIE_HOST, CSRF_COOKIE_FALLBACK] as const;

/** HTTPS from reverse proxy (Traefik) or configured APP_URL. */
async function isRequestSecure(): Promise<boolean> {
	try {
		const h = await headers();
		const proto = h
			.get("x-forwarded-proto")
			?.split(",")[0]
			?.trim()
			.toLowerCase();
		if (proto === "https") return true;
		if (proto === "http") return false;
	} catch {
		logger.warn(
			"Headers unavailable during static analysis in isRequestSecure",
		);
	}
	try {
		if (env.APP_URL) return new URL(env.APP_URL).protocol === "https:";
	} catch {
		logger.warn("Malformed APP_URL in isRequestSecure");
	}
	return process.env.NODE_ENV === "production";
}

function preferredCsrfCookieName(secure: boolean): string {
	return secure ? CSRF_COOKIE_HOST : CSRF_COOKIE_FALLBACK;
}

function readExistingCsrfCookie(
	c: Awaited<ReturnType<typeof cookies>>,
): string | undefined {
	for (const name of CSRF_COOKIE_NAMES) {
		const existing = c.get(name);
		if (existing?.value && existing.value.length === CSRF_BYTES * 2)
			return existing.value;
	}
	return undefined;
}

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
	[
		env.APP_URL ? new URL(env.APP_URL).host : "",
		"localhost",
		"127.0.0.1",
	].filter(Boolean),
);

const SAFE_REDIRECT_PATHS = new Set([
	"/login",
	"/register",
	"/forgot",
	"/reset",
	"/verify",
	"/banned",
	"/maintenance",
	"/",
	"/me",
	"/settings",
]);

function isSafePath(path: string): boolean {
	if (!path.startsWith("/")) return false;
	if (SAFE_REDIRECT_PATHS.has(path)) return true;
	if (path.startsWith("/admin/") || path.startsWith("/cms_api/")) return true;
	return false;
}

export function safeRedirect(
	destination: string,
	fallback: string = "/",
): string {
	try {
		const url = new URL(destination, env.APP_URL || "http://localhost:3000");
		if (ALLOWED_HOSTS.has(url.host)) return destination;
		if (url.host === "localhost" || url.host === "127.0.0.1")
			return destination;
	} catch {
		logger.warn("Failed to parse redirect URL", { destination });
		if (isSafePath(destination)) return destination;
	}
	return fallback;
}

export function redirectSafe(
	destination: string,
	fallback: string = "/",
): never {
	redirect(safeRedirect(destination, fallback));
}

function csrfCookieOpts(
	name: string,
	value: string,
	secure: boolean,
): {
	name: string;
	value: string;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "lax";
	path: string;
	maxAge: number;
} {
	return {
		name,
		value,
		httpOnly: true,
		secure,
		sameSite: "lax" as const,
		path: "/",
		maxAge: CSRF_COOKIE_MAX_AGE,
	};
}

function trySetCsrfCookie(
	c: Awaited<ReturnType<typeof cookies>>,
	opts: ReturnType<typeof csrfCookieOpts>,
): boolean {
	try {
		c.set(opts.name, opts.value, opts);
		return true;
	} catch {
		logger.warn("Failed to set CSRF cookie", { name: opts.name });
		return false;
	}
}

/** Read-only access for Server Components, which cannot write response cookies. */
export async function readCsrfCookieToken(): Promise<string> {
	try {
		return readExistingCsrfCookie(await cookies()) ?? "";
	} catch {
		logger.warn("Failed to read CSRF cookie");
		return "";
	}
}

/** Sets the CSRF cookie when possible; returns token or empty string (never throws). */
export async function setCsrfCookie(): Promise<string> {
	try {
		const c = await cookies();
		const existing = readExistingCsrfCookie(c);
		if (existing) return existing;

		const value = crypto.randomBytes(CSRF_BYTES).toString("hex");
		const secure = await isRequestSecure();
		const primary = csrfCookieOpts(
			preferredCsrfCookieName(secure),
			value,
			secure,
		);
		if (trySetCsrfCookie(c, primary)) return value;

		const fallback = csrfCookieOpts(CSRF_COOKIE_FALLBACK, value, secure);
		if (trySetCsrfCookie(c, fallback)) return value;

		return "";
	} catch {
		logger.warn("Failed to set CSRF cookie (outer)");
		return "";
	}
}

export async function validateCsrfToken(token: string): Promise<boolean> {
	if (!token || token.length !== CSRF_BYTES * 2) return false;
	try {
		const c = await cookies();
		let stored: string | undefined;
		for (const name of CSRF_COOKIE_NAMES) {
			const candidate = c.get(name)?.value;
			if (candidate && candidate.length === CSRF_BYTES * 2) {
				stored = candidate;
				break;
			}
		}
		if (!stored) return false;
		return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(stored));
	} catch {
		logger.warn("CSRF token validation failed");
		return false;
	}
}

export function canonicalize(input: string): string {
	return input.normalize("NFC").trim();
}

/** Normalize, trim and truncate a form field value to maxLen (default 255). */
export function sanitizeField(
	value: FormDataEntryValue | null,
	maxLen = 255,
): string {
	const s = canonicalize(String(value ?? ""));
	return s.slice(0, maxLen);
}

export async function extractClientIpAsync(): Promise<IpAddress> {
	try {
		return resolveClientIp(await headers()) as IpAddress;
	} catch {
		logger.warn("Failed to get client IP from headers");
		return UNKNOWN_CLIENT_IP as IpAddress;
	}
}
