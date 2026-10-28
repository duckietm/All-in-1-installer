"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { dropdownVariants } from "@/lib/motion";

/**
 * Animated body of a nav dropdown. Split out so `motion/react` (~43 KB gzip)
 * only ships when a dropdown is actually opened — it used to sit in every
 * public page's initial bundle. Loaded client-side only; the closed state is
 * rendered by the parent as plain HTML.
 */
export default function NavDropdownPanel({
	open,
	children,
}: {
	open: boolean;
	children: ReactNode;
}) {
	return (
		<AnimatePresence>
			{open ? (
				<motion.div
					variants={dropdownVariants}
					initial="hidden"
					animate="visible"
					exit="exit"
					className="dropdown-menu md:absolute left-0 top-full mt-0.5 min-w-0 md:min-w-[200px] rounded-xl z-50 py-2"
					role="menu"
				>
					{children}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
