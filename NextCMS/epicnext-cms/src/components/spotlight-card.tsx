"use client";

import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useRef,
} from "react";

interface SpotlightCardProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}

/**
 * Wraps a card with a mouse-tracking radial glow. The pointer position is
 * written to `--spot-x` / `--spot-y` and consumed by the `.spotlight::before`
 * overlay in globals.css.
 *
 * The pointer move handler is throttled to one update per animation frame:
 * a pointermove fires far more often than the browser paints, and every
 * extra write re-styles the card (and its ::before gradient) for nothing.
 */
export function SpotlightCard({
	children,
	className,
	style,
}: SpotlightCardProps) {
	const frame = useRef(0);
	const pending = useRef<{ x: number; y: number } | null>(null);

	// Drop the queued frame if the card is removed mid-gesture.
	useEffect(
		() => () => {
			if (frame.current) cancelAnimationFrame(frame.current);
		},
		[],
	);

	const handlePointerMove = (event: MouseEvent<HTMLDivElement>) => {
		const el = event.currentTarget;
		const rect = el.getBoundingClientRect();
		pending.current = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
		if (frame.current) return;

		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			const point = pending.current;
			if (!point) return;
			el.style.setProperty("--spot-x", `${point.x}px`);
			el.style.setProperty("--spot-y", `${point.y}px`);
		});
	};

	return (
		<div
			className={className ? `spotlight ${className}` : "spotlight"}
			style={
				{ "--spot-x": "50%", "--spot-y": "50%", ...style } as CSSProperties
			}
			onPointerMove={handlePointerMove}
		>
			{children}
		</div>
	);
}
