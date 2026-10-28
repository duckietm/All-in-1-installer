"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedCounter({
	value,
	suffix = "",
}: {
	value: number;
	suffix?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const isInView = useInView(ref);
	const prefersReducedMotion = useReducedMotion();
	const started = useRef(false);
	const [display, setDisplay] = useState(0);

	useEffect(() => {
		if (!isInView) return;

		if (started.current) {
			setDisplay(value);
			return;
		}
		started.current = true;

		if (prefersReducedMotion) {
			setDisplay(value);
			return;
		}

		const duration = 1200;
		const start = performance.now();
		let raf = 0;

		const tick = (now: number) => {
			const progress = Math.min((now - start) / duration, 1);
			const eased = 1 - (1 - progress) ** 3;
			setDisplay(Math.round(eased * value));
			if (progress < 1) {
				raf = requestAnimationFrame(tick);
			} else {
				setDisplay(value);
			}
		};

		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [isInView, value, prefersReducedMotion]);

	// Plain span, no motion/react: this counter renders on the public home page
	// and the rise/fade was the only thing the library was used for here. The
	// count-up itself was already driven by requestAnimationFrame. The
	// `counter-rise` class keeps the entrance and is neutralised for visitors who
	// ask for reduced motion by the global block in globals.css.
	return (
		<span ref={ref} className="counter-rise">
			{display.toLocaleString()}
			{suffix}
		</span>
	);
}

/**
 * Replaces motion/react's `useInView`. It only had to answer "is the element on
 * screen", which an IntersectionObserver does without pulling the library in.
 */
function useInView(ref: React.RefObject<HTMLElement | null>) {
	const [inView, setInView] = useState(false);

	useEffect(() => {
		const node = ref.current;
		if (!node || inView) return;
		if (typeof IntersectionObserver === "undefined") {
			setInView(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						// Latch: the counter only animates once, so disconnect as
						// soon as it has been seen.
						setInView(true);
						observer.disconnect();
						return;
					}
				}
			},
			{ rootMargin: "-50px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ref, inView]);

	return inView;
}

/** Media-query read for `prefers-reduced-motion`. */
function useReducedMotion() {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(query.matches);
		const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
