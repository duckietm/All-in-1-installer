"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Route-change entrance animation.
 *
 * Pure CSS on purpose: the motion/react build this used to pull in cost ~43 KB
 * gzip on every public page's initial JS. The animation itself stays identical
 * (see `.page-enter` in globals.css), and the global `prefers-reduced-motion`
 * block already neutralises it for visitors who ask for less motion.
 */
export default function MotionPageWrapper({
	children,
}: {
	children: ReactNode;
}) {
	const pathname = usePathname();

	return (
		<div key={pathname} className="page-enter">
			{children}
		</div>
	);
}
