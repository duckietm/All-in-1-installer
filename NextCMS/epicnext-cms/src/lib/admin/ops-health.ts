import "server-only";

import { count, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { env } from "@/env";
import { db, User } from "@/lib/db";
import { redis } from "@/lib/redis";
import { rcon } from "@/lib/services/rcon";

export type OpsHealth = {
	dbOk: boolean;
	dbLatencyMs: number;
	/** null = REDIS_URL unset (optional); true/false = probe result */
	redisOk: boolean | null;
	emulatorOk: boolean;
	onlineUsers: number;
};

/**
 * Shared DB + Redis + emulator health probe for CommandoCentrum, DevOps, and APIs.
 * Semantics match `/cms_api/health` for Redis (null when not configured).
 */
export const fetchOpsHealth = cache(
	async function fetchOpsHealth(): Promise<OpsHealth> {
		const [dbProbe, redisOk, emulatorOk, onlineUsers] = await Promise.all([
			(async () => {
				try {
					const start = Date.now();
					await db.execute(sql`SELECT 1`);
					return { dbOk: true, dbLatencyMs: Date.now() - start };
				} catch {
					return { dbOk: false, dbLatencyMs: 0 };
				}
			})(),
			(async (): Promise<boolean | null> => {
				if (!env.REDIS_URL) return null;
				if (!redis) return false;
				try {
					const pong = await redis.ping();
					return pong === "PONG";
				} catch {
					return false;
				}
			})(),
			rcon.send("ping", null).catch(() => false),
			db
				.select({ total: count() })
				.from(User)
				.where(eq(User.online, "1"))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
		]);
		return {
			dbOk: dbProbe.dbOk,
			dbLatencyMs: dbProbe.dbLatencyMs,
			redisOk,
			emulatorOk: Boolean(emulatorOk),
			onlineUsers,
		};
	},
);
