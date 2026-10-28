import { PHASE_PRODUCTION_BUILD } from "next/constants";
import "server-only";

import Redis from "ioredis";
import { env } from "@/env";
import { logger } from "@/lib/logger";

const globalForRedis = globalThis as unknown as {
	redis?: Redis | null;
	redisMissingWarned?: boolean;
};

function createRedis(): Redis | null {
	const url = env.REDIS_URL;
	if (!url) {
		if (
			env.NODE_ENV === "production" &&
			process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD &&
			!globalForRedis.redisMissingWarned
		) {
			globalForRedis.redisMissingWarned = true;
			logger.error(
				"[redis] REDIS_URL is unset in production. Rate limits, site-settings cache, and JWT session invalidation fall back to in-process memory and will not work correctly across multiple instances or restarts. Set REDIS_URL in .env.",
			);
		}
		return null;
	}
	try {
		const client = new Redis(url, {
			maxRetriesPerRequest: 3,
			retryStrategy(times) {
				return Math.min(times * 200, 5000);
			},
			lazyConnect: true,
		});
		client.on("error", (err) => {
			logger.warn("[redis] Connection error", { error: String(err) });
		});
		return client;
	} catch (err) {
		logger.warn("[redis] Failed to create Redis client", {
			error: String(err),
		});
		return null;
	}
}

export const redis: Redis | null =
	globalForRedis.redis !== undefined ? globalForRedis.redis : createRedis();
if (globalForRedis.redis === undefined) globalForRedis.redis = redis;
