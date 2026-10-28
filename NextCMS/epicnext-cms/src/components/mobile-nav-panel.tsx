"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type { ReactNode } from "react";
import { mobileMenuVariants } from "@/lib/motion";

/**
 * Animated mobile menu sheet, split out of `MobileNav` so `motion/react` only
 * ships once the hamburger menu is opened instead of on every public page.
 */
export default function MobileNavPanel({
	open,
	menuId,
	menuRef,
	brandLabel,
	closeLabel,
	children,
}: {
	open: boolean;
	menuId: string;
	menuRef: React.RefObject<HTMLDivElement | null>;
	brandLabel: string;
	closeLabel: string;
	children: ReactNode;
}) {
	return (
		<AnimatePresence>
			{open ? (
				<motion.div
					id={menuId}
					role="dialog"
					aria-modal="true"
					aria-label={brandLabel || "Navigation menu"}
					className="absolute left-0 top-full mt-2 w-[min(88vw,360px)] z-50 origin-top-left"
					style={{ backgroundColor: "transparent" }}
					variants={mobileMenuVariants}
					initial="hidden"
					animate="visible"
					exit="exit"
				>
					<div
						ref={menuRef}
						className="flex flex-col gap-y-1 p-2 rounded-2xl border shadow-xl max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain
						bg-[var(--color-dropdown,var(--color-surface,#fff))]"
						style={{
							borderColor:
								"color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
							boxShadow:
								"0 12px 40px color-mix(in srgb, rgb(0 0 0) 22%, transparent)",
						}}
					>
						<div
							className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl"
							style={{
								backgroundColor:
									"color-mix(in srgb, var(--color-primary) 12%, transparent)",
							}}
						>
							<Image
								src="/assets/images/icons/navigation/home.png"
								alt=""
								width={22}
								height={22}
								className="shrink-0"
							/>
							<span
								className="text-sm font-extrabold uppercase tracking-wide"
								style={{
									color: "var(--color-navbar-text-readable, var(--color-text))",
								}}
							>
								{brandLabel}
							</span>
							<span className="ml-auto text-[11px] font-semibold uppercase tracking-wider opacity-75">
								{closeLabel}
							</span>
						</div>

						{children}
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
