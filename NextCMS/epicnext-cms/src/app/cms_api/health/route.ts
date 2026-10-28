import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { apiJson } from "@/lib/api";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { rcon } from "@/lib/services/rcon";

/**
 * Ops health probe: database reachability, Redis (when configured), emulator
 * RCON, SMTP (when configured), and runtime info.
 *
 * HTTP status is load-bearing: 200 means the CMS can actually serve, 503 means
 * it cannot. Previously this route answered 200 even with the database down,
 * so the Docker healthcheck reported a container "healthy" while every page
 * 500'd. Only the database drives the status — Redis and the emulator degrade
 * to in-process fallbacks (see `cache.ts` and `rate-limit.ts`), so failing the
 * container on those would trade a slow site for an outage. Docker does not
 * restart on `unhealthy`, so this reports rather than recycles.
 */
export async function GET() {
	const ip = await clientIp();
	const limit = await rateLimit(`health:${ip}`, 60, 60_000);
	if (!limit.ok) {
		return NextResponse.json(
			{ status: "rate_limited", retryAfter: limit.retryAfter },
			{
				status: 429,
				headers: { "Retry-After": String(limit.retryAfter) },
			},
		);
	}

	const database = await db
		.execute(sql`SELECT 1`)
		.then(() => true)
		.catch(() => false);

	let redisOk: boolean | null = null;
	if (env.REDIS_URL) {
		if (!redis) {
			redisOk = false;
		} else {
			try {
				const pong = await redis.ping();
				redisOk = pong === "PONG";
			} catch {
				redisOk = false;
			}
		}
	}

	const emulator = await rcon.send("ping", null).catch(() => false);

	const resendAvailable = !!env.RESEND_API_KEY;

	const degraded = !database || redisOk === false;
	return apiJson(
		{
			status: degraded ? "degraded" : "ok",
			database,
			redis: redisOk,
			emulator,
			resend: resendAvailable,
			node: process.version,
			release: process.env.NEXT_PUBLIC_CMS_RELEASE ?? "unknown",
			uptime: Math.round(process.uptime()),
			time: new Date().toISOString(),
		},
		{ status: database ? 200 : 503 },
	);
}
