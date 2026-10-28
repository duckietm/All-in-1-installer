import type { Variants } from "motion/react";

export const pageTransition: Variants = {
	initial: { opacity: 0, y: 8 },
	enter: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] },
	},
	exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

export const dropdownVariants: Variants = {
	hidden: { opacity: 0, y: -6, scale: 0.97 },
	visible: {
		opacity: 1,
		y: 0,
		scale: 1,
		transition: { duration: 0.18, ease: "easeOut" },
	},
	exit: { opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.12 } },
};

export const mobileMenuVariants: Variants = {
	hidden: { opacity: 0, scale: 0.96, y: -8 },
	visible: {
		opacity: 1,
		scale: 1,
		y: 0,
		transition: { duration: 0.2, ease: "easeOut" },
	},
	exit: { opacity: 0, scale: 0.96, y: -6, transition: { duration: 0.15 } },
};

export const modalOverlayVariants: Variants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1, transition: { duration: 0.2 } },
	exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalContentVariants: Variants = {
	hidden: { opacity: 0, scale: 0.95, y: 10 },
	visible: {
		opacity: 1,
		scale: 1,
		y: 0,
		transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] },
	},
	exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
};
