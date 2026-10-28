"use client";

import { useEffect, useRef, useState } from "react";

type UseEventSourceOptions = {
	onMessage?: (data: unknown) => void;
	onError?: (event: Event) => void;
	enabled?: boolean;
	/** Max reconnect attempts after errors (default 8). Set 0 to disable reconnect. */
	maxRetries?: number;
	/** Initial reconnect delay in ms (default 1000); doubles each attempt. */
	baseDelayMs?: number;
	/** Cap on reconnect delay in ms (default 30000). */
	maxDelayMs?: number;
};

/**
 * Subscribe to a Server-Sent Events (SSE) endpoint.
 * Reconnects with exponential backoff up to `maxRetries`.
 */
export function useEventSource<T = unknown>(
	url: string | null,
	options?: UseEventSourceOptions,
) {
	const {
		onMessage,
		onError,
		enabled = true,
		maxRetries = 8,
		baseDelayMs = 1000,
		maxDelayMs = 30_000,
	} = options ?? {};
	const [data, setData] = useState<T | null>(null);
	const [connected, setConnected] = useState(false);
	const onMessageRef = useRef(onMessage);
	const onErrorRef = useRef(onError);
	onMessageRef.current = onMessage;
	onErrorRef.current = onError;

	useEffect(() => {
		if (!url || !enabled) return;

		const endpoint: string = url;
		let es: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		let attempt = 0;
		let disposed = false;

		function connect() {
			if (disposed) return;
			es = new EventSource(endpoint);

			es.onopen = () => {
				attempt = 0;
				setConnected(true);
			};

			es.onmessage = (event) => {
				try {
					const parsed = JSON.parse(event.data) as T;
					setData(parsed);
					onMessageRef.current?.(parsed);
				} catch {
					// ignore malformed messages
				}
			};

			es.onerror = (event) => {
				es?.close();
				es = null;
				setConnected(false);
				onErrorRef.current?.(event);

				if (disposed || attempt >= maxRetries) return;

				const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
				attempt++;
				reconnectTimer = setTimeout(connect, delay);
			};
		}

		connect();

		return () => {
			disposed = true;
			if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
			es?.close();
			setConnected(false);
		};
	}, [url, enabled, maxRetries, baseDelayMs, maxDelayMs]);

	return { data, connected };
}
