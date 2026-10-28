"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * The animated body loads lazily (`motion/react` is ~43 KB gzip and only needed
 * while a dropdown is open), so public pages pay nothing until the first
 * interaction.
 */
const NavDropdownPanel = dynamic(
	() => import("@/components/nav-dropdown-panel"),
	{ ssr: false },
);

interface NavDropdownProps {
	label: string;
	icon?: string;
	/** Rendered as a link (default) or a menu item (`as="menu"`). */
	children: ReactNode;
}

export function NavDropdown({ label, icon, children }: NavDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		if (open) document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	useEffect(() => {
		function onOutsideClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", onOutsideClick);
		}
		return () => document.removeEventListener("mousedown", onOutsideClick);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="nav-item cursor-pointer"
				aria-haspopup="true"
				aria-expanded={open}
			>
				{icon ? (
					<Image
						src={icon}
						alt=""
						width={20}
						height={20}
						className="mr-1.5"
						unoptimized
					/>
				) : null}
				{label}
				<svg
					className="ml-auto md:ml-1 w-3 h-3 shrink-0 transition-transform duration-200"
					style={{ transform: open ? "rotate(180deg)" : undefined }}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>
			{/* Closed state is plain HTML; the animation loads on first open. */}
			<NavDropdownPanel open={open}>{children}</NavDropdownPanel>
		</div>
	);
}
