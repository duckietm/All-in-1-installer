import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { getAntiddosConfig } from "@/lib/antiddos-config";
import { resolveClientIp, UNKNOWN_CLIENT_IP } from "@/lib/client-ip";
import { isCloudflareProxied } from "@/lib/cloudflare";
import { maybeAutoBlockCloudflare } from "@/lib/cloudflare-api";
import { classifyDdos, isSuspiciousPath } from "@/lib/ddos";
import { rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

export type DdosDecision =
	| { outcome: "pass" }
	| { outcome: "suspect" }
	| { outcome: "block"; retryAfterSeconds: number };

function isEnabled(): boolean {
	if (env.NODE_ENV !== "production") return false;
	return env.ANTI_DDOS_ENABLED;
}

// Once the global valve trips, shed every request for a short spell from
// process memory only — no further Redis round-trips — so a live flood can
// never pile request-handling work onto the limiter itself.
let globalHaltedUntil = 0;

function blockTtlForViolations(
	violations: number,
	tiers: readonly { minViolations: number; ttlSeconds: number }[],
): number {
	let ttl = tiers[0]?.ttlSeconds ?? 600;
	for (const tier of tiers) {
		if (violations >= tier.minViolations) ttl = tier.ttlSeconds;
	}
	return ttl;
}

/**
 * App-layer anti-DDoS gate for the Next.js proxy. Reuses the app-wide
 * Redis/in-memory buckets (so multi-instance deployments share state) and the
 * audited IP resolver. Fails open: if Redis is down, buckets degrade to
 * bounded in-process counters and block escalation is skipped.
 *
 * Tunables come from the anti-DDoS config (env boot defaults, live-overridden
 * by the admin panel via Redis). `/cms_api/health` is exempt so the Docker
 * liveness probe never trips the gate.
 */
export async function enforceDdosRateLimit(
	req: NextRequest,
): Promise<DdosDecision> {
	if (!isEnabled()) return { outcome: "pass" };
	const config = await getAntiddosConfig();
	if (!config.enabled) return { outcome: "pass" };

	const pathname = req.nextUrl.pathname;
	if (pathname === "/cms_api/health") return { outcome: "pass" };
	if (isSuspiciousPath(pathname)) return { outcome: "suspect" };

	const now = Date.now();
	if (now < globalHaltedUntil) {
		return { outcome: "block", retryAfterSeconds: 1 };
	}

	const ip = resolveClientIp(req.headers);
	// A trusted ingress always resolves a real client address. `0.0.0.0` is the
	// sentinel for header-less loopback traffic (health checks, CI browser
	// gates, monitoring). If it were rate-limited or blocked it would occupy a
	// single shared key, and any burst of synthetic local traffic could then
	// shed all origin-verified requests — exactly what broke CI smoke tests.
	if (ip === UNKNOWN_CLIENT_IP) return { outcome: "pass" };
	const blockKey = `antiddos:block:${ip}`;
	if (redis) {
		try {
			if ((await redis.get(blockKey)) !== null) {
				return {
					outcome: "block",
					retryAfterSeconds: blockTtlForViolations(0, config.blockTiers),
				};
			}
		} catch {
			// fail-open: never let the limiter itself take the site down.
		}
	}

	const category = classifyDdos(pathname);
	const rule = config[category];
	const bucket = await rateLimit(
		`antiddos:${category}:${ip}`,
		rule.limit,
		rule.windowSeconds * 1000,
	);
	if (bucket.ok) {
		// The site-wide valve counts only requests that passed their own per-IP bucket, so a
		// few clients over their limit cannot fill it and halt the site for everyone.
		const global = await rateLimit(
			"antiddos:global:all",
			config.global.limit,
			config.global.windowSeconds * 1000,
		);
		if (!global.ok) {
			globalHaltedUntil = now + config.globalHaltMs;
			return {
				outcome: "block",
				retryAfterSeconds: Math.max(global.retryAfter, 1),
			};
		}
		if (globalHaltedUntil !== 0) globalHaltedUntil = 0;
		return { outcome: "pass" };
	}

	let violations = 1;
	if (redis) {
		try {
			const counterKey = `antiddos:v:${ip}`;
			violations = await redis.incr(counterKey);
			if (violations === 1) {
				await redis.pexpire(counterKey, config.violationWindowSeconds * 1000);
			}
			const ttl = blockTtlForViolations(violations, config.blockTiers);
			if (violations >= config.maxViolations) {
				await redis.set(blockKey, "1", "EX", ttl);
				// Mirror the host-level block to the Cloudflare edge (IP Access
				// Rules) so a repeat offender is shed before it reaches the
				// origin. Only when this request demonstrably transited
				// Cloudflare — that is when the client IP is trustworthy.
				void maybeAutoBlockCloudflare({
					ip,
					ttlSeconds: ttl,
					category,
					enabled:
						config.cloudflareAutoBlock && isCloudflareProxied(req.headers),
				});
			}
			return { outcome: "block", retryAfterSeconds: ttl };
		} catch {
			// fail-open — Redis merely unavailable; in-process buckets still shed.
		}
	}
	return {
		outcome: "block",
		retryAfterSeconds: Math.max(bucket.retryAfter, 1),
	};
}

export function ddosReject(
	status: 403 | 429,
	retryAfterSeconds = 0,
): NextResponse {
	const headers: Record<string, string> = {
		"Cache-Control": "no-store",
		"X-Rate-Limit": "1",
	};
	if (retryAfterSeconds > 0) headers["Retry-After"] = String(retryAfterSeconds);
	return new NextResponse(null, { status, headers });
}
