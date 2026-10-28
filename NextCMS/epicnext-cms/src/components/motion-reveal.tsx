"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

interface RevealProps {
	children: ReactNode;
	className?: string;
	/** Seconds to wait before the reveal starts. */
	delay?: number;
}

/**
 * Fade-and-rise-on-scroll, without motion/react.
 *
 * This component sits on the public home page, the auth pages and the settings
 * page, so the animation library used to be pulled into their initial bundle
 * for this one effect. The behaviour is a plain IntersectionObserver plus two
 * CSS classes.
 *
 * Two safety rules, because "invisible until a scroll event" is a bad failure
 * mode:
 *   - `.motion-reveal` starts at `opacity: 0` and is only restored by the
 *     animation, so globals.css forces it visible under
 *     `prefers-reduced-motion`, and the root layout ships a `<noscript>` rule
 *     for the no-JavaScript case. Either way the content is readable.
 *   - The observer latches and disconnects, matching the previous `once: true`.
 */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(false);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		if (typeof IntersectionObserver === "undefined") {
			setShown(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setShown(true);
						observer.disconnect();
						return;
					}
				}
			},
			{ rootMargin: "-40px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={ref}
			// The theme panel's "Scroll Reveal" toggle selects `.motion-reveal`;
			// it previously matched nothing because the class was never emitted.
			className={`motion-reveal${shown ? " motion-reveal-in" : ""}${
				className ? ` ${className}` : ""
			}`}
			style={delay ? { animationDelay: `${delay}s` } : undefined}
		>
			{children}
		</div>
	);
}
