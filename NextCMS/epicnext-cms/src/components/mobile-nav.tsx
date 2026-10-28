"use client";

import dynamic from "next/dynamic";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

/** Lazily loaded so `motion/react` is not in the public pages' initial JS. */
const MobileNavPanel = dynamic(() => import("@/components/mobile-nav-panel"), {
	ssr: false,
});

interface MobileNavProps {
	children: ReactNode;
	menuLabel?: string;
	closeLabel?: string;
	brandLabel?: string;
}

export function MobileNav({
	children,
	menuLabel = "Open menu",
	closeLabel = "Close menu",
	brandLabel = "",
}: MobileNavProps) {
	const [open, setOpen] = useState(false);
	const detailsRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const prevFocusRef = useRef<HTMLElement | null>(null);
	const menuId = useId();

	const handleEscape = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape" && open) {
				setOpen(false);
				(prevFocusRef.current ?? toggleRef.current)?.focus();
			}
		},
		[open],
	);

	useEffect(() => {
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [handleEscape]);

	// Initial focus, scroll-lock, click-outside close, focus restore.
	useEffect(() => {
		if (!open) return;
		prevFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		menuRef.current
			?.querySelector<HTMLElement>(
				'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
			)
			?.focus();
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		function handlePointerDown(e: PointerEvent) {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				!toggleRef.current?.contains(e.target as Node)
			) {
				setOpen(false);
			}
		}
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.body.style.overflow = prevOverflow;
			document.removeEventListener("pointerdown", handlePointerDown);
			(prevFocusRef.current ?? toggleRef.current)?.focus();
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		if (!menu) return;

		const focusableSelector =
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

		function handleTab(e: KeyboardEvent) {
			if (e.key !== "Tab" || !menu) return;
			const focusable = Array.from(
				menu.querySelectorAll<HTMLElement>(focusableSelector),
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}

		menu.addEventListener("keydown", handleTab);
		return () => menu.removeEventListener("keydown", handleTab);
	}, [open]);

	return (
		<div ref={detailsRef} className="group relative md:hidden">
			<button
				ref={toggleRef}
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="list-none cursor-pointer flex items-center justify-center w-11 h-11 rounded-xl shrink-0
					transition-colors duration-150
					hover:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)]
					active:scale-[0.96]
					focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-readable,var(--color-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-navbar)]"
				aria-label={open ? closeLabel : menuLabel}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-controls={menuId}
			>
				<svg
					className="w-6 h-6 transition-transform duration-200"
					style={{ transform: open ? "rotate(90deg)" : undefined }}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					{open ? (
						<>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</>
					) : (
						<>
							<line x1="4" y1="7" x2="20" y2="7" />
							<line x1="4" y1="12" x2="20" y2="12" />
							<line x1="4" y1="17" x2="20" y2="17" />
						</>
					)}
				</svg>
			</button>

			<MobileNavPanel
				open={open}
				menuId={menuId}
				menuRef={menuRef}
				brandLabel={brandLabel}
				closeLabel={closeLabel}
			>
				{children}
			</MobileNavPanel>
		</div>
	);
}
