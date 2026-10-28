"use client";

import { useEffect, useState } from "react";

type Listener = (count: number) => void;

/* Single shared EventSource for /api/online/count/stream. Every subscribing
 * component re-uses one connection (multicast to all listeners) instead of
 * opening its own SSE socket per component. */
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

let eventSource: EventSource | null = null;
const listeners = new Set<Listener>();
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;

function start() {
	if (eventSource || refCount === 0) return;
	eventSource = new EventSource("/api/online/count/stream");
	eventSource.onopen = () => {
		attempts = 0;
	};
	eventSource.onmessage = (event) => {
		try {
			const parsed = JSON.parse(event.data) as { count?: number };
			if (typeof parsed.count === "number") {
				const count = parsed.count;
				listeners.forEach((listener) => {
					listener(count);
				});
			}
		} catch {
			// ignore malformed messages
		}
	};
	eventSource.onerror = () => {
		eventSource?.close();
		eventSource = null;
		if (refCount === 0 || attempts >= MAX_RETRIES) return;
		const delay = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
		attempts++;
		reconnectTimer = setTimeout(start, delay);
	};
}

function stop() {
	if (refCount > 0 || !eventSource) return;
	if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
	eventSource.close();
	eventSource = null;
	attempts = 0;
}

/**
 * Live online-user count shared by the header and the hero/stats counters.
 * Falls back to the server-rendered `initial` value until the stream reports.
 */
export function useOnlineCount(initial: number): number {
	const [count, setCount] = useState(initial);

	useEffect(() => {
		const listener: Listener = setCount;
		refCount++;
		listeners.add(listener);
		start();
		return () => {
			listeners.delete(listener);
			refCount--;
			stop();
		};
	}, []);

	return count;
}
