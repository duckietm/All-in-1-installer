"use client";

import { AnimatedCounter } from "@/components/animated-counter";
import { useOnlineCount } from "@/lib/online-count-sse";

/**
 * Live animated online-count number. Shares a single SSE connection (see
 * `useOnlineCount`) so the whole page uses one socket instead of one per
 * counter, while keeping the entrance counter animation.
 */
export function LiveOnlineCounter({
	initial,
	suffix = "",
}: {
	initial: number;
	suffix?: string;
}) {
	const count = useOnlineCount(initial);

	return <AnimatedCounter value={count} suffix={suffix} />;
}
