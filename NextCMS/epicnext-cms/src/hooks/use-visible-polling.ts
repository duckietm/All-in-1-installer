"use client";
import { useEffect, useRef } from "react";
/** Refresh after the prior request settles; pause while the tab is hidden. */
export function useVisiblePolling(
	refresh: () => Promise<unknown>,
	delay: number,
) {
	const callback = useRef(refresh);
	callback.current = refresh;
	useEffect(() => {
		let stopped = false,
			running = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function tick() {
			if (stopped || running) return;
			clearTimeout(timer);
			if (document.visibilityState === "hidden") return;
			running = true;
			try {
				await callback.current();
			} finally {
				running = false;
				if (!stopped) timer = setTimeout(tick, delay);
			}
		}
		function visibility() {
			if (document.visibilityState === "visible") void tick();
			else clearTimeout(timer);
		}
		void tick();
		document.addEventListener("visibilitychange", visibility);
		return () => {
			stopped = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [delay]);
}
