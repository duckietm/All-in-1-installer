"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Global progress indicator for page transitions.
 *
 * Driven by a CSS class instead of motion/react — the progress bar used to be
 * the only reason the masonry-free public layout shipped the whole animation
 * runtime to every visitor. Class names come from globals.css (`.route-progress`).
 */
export function GlobalProgressBar() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isLoading, setIsLoading] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Route changes intentionally restart the indicator timer.
	useEffect(() => {
		setIsLoading(true);
		const timer = setTimeout(() => {
			setIsLoading(false);
		}, 400);

		return () => clearTimeout(timer);
	}, [pathname, searchParams]);

	return (
		<div
			aria-hidden="true"
			data-loading={isLoading ? "true" : "false"}
			className="route-progress"
		>
			<span className="route-progress__bar" />
		</div>
	);
}
