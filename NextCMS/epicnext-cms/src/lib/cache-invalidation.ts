import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

/**
 * Cross-process cache signals over Redis pub/sub.
 *
 * Every process keeps its own in-process fast path, so writing a value to Redis
 * is not enough: without a signal, every *other* instance keeps serving its own
 * copy until the full TTL elapses. Publishing on a channel lets all instances
 * react immediately, which is what makes an invalidation actually take effect.
 *
 * This is strictly an optimisation. If the subscription never comes up, callers
 * still behave correctly and fall back to TTL-based expiry.
 */

/** Carries a cache key that must be dropped everywhere. */
export const INVALIDATE_CHANNEL = "cache:invalidate";

type Handler = (message: string) => void;

const handlers = new Map<string, Set<Handler>>();

// `undefined` = not started yet, `null` = unavailable in this process.
let subscriber: Redis | null | undefined;
let warnedUnavailable = false;

function canSubscribe(): boolean {
	// Never open a connection in the browser, and never during `next build`
	// prerendering: a live socket would keep the build process from exiting.
	if (typeof window !== "undefined") return false;
	if (process.env.NEXT_PHASE === "phase-production-build") return false;
	return true;
}

function dispatch(channel: string, message: string): void {
	for (const handler of handlers.get(channel) ?? []) {
		try {
			handler(message);
		} catch (error) {
			logger.warn("[cache] signal handler failed", {
				channel,
				error: String(error),
			});
		}
	}
}

function ensureSubscriber(): Redis | null {
	if (subscriber !== undefined) return subscriber;
	subscriber = null;
	if (!redis || !canSubscribe()) return null;
	try {
		const client: Redis = redis.duplicate();
		client.on("error", (error) => {
			logger.warn("[cache] subscriber error", { error: String(error) });
		});
		client.on("message", dispatch);
		subscriber = client;
	} catch (error) {
		logger.warn("[cache] subscriber unavailable", { error: String(error) });
	}
	return subscriber;
}

async function subscribe(channel: string): Promise<void> {
	const client = ensureSubscriber();
	if (!client) return;
	try {
		await client.subscribe(channel);
	} catch (error) {
		logger.warn("[cache] subscribe failed", {
			channel,
			error: String(error),
		});
	}
}

const subscribed = new Set<string>();

/**
 * Run `handler` for every message published on `channel` by any process.
 * Returns an unsubscribe function. Safe to call when Redis is absent — the
 * handler simply never fires and TTL expiry remains the fallback.
 */
export function onCacheSignal(channel: string, handler: Handler): () => void {
	let set = handlers.get(channel);
	if (!set) {
		set = new Set();
		handlers.set(channel, set);
	}
	set.add(handler);
	if (!subscribed.has(channel)) {
		subscribed.add(channel);
		void subscribe(channel);
	}
	return () => {
		set.delete(handler);
		if (set.size === 0) handlers.delete(channel);
	};
}

function warnUnavailable(reason: string): void {
	if (warnedUnavailable || process.env.NODE_ENV !== "production") return;
	warnedUnavailable = true;
	logger.warn(
		"[cache] Signals cannot reach other instances; entries fall back to TTL expiry.",
		{ reason },
	);
}

/** Publish a message on `channel` for every other process to react to. */
export async function publishCacheSignal(
	channel: string,
	message: string,
): Promise<void> {
	if (!redis) return;
	if (redis.status === "end") {
		warnUnavailable("connection closed");
		return;
	}
	try {
		await redis.publish(channel, message);
	} catch (error) {
		warnUnavailable(String(error));
	}
}

/** Drop `key` from the in-process cache of every process. */
export function onCacheInvalidated(handler: Handler): () => void {
	return onCacheSignal(INVALIDATE_CHANNEL, handler);
}

/** Tell every other process to drop `key` from its in-process cache. */
export async function publishCacheInvalidation(key: string): Promise<void> {
	await publishCacheSignal(INVALIDATE_CHANNEL, key);
}
