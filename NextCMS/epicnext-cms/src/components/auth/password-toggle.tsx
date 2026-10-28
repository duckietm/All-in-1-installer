"use client";

import { Eye, EyeOff } from "lucide-react";

/**
 * Round eye-icon button that reveals / hides a password field. Kept separate so
 * the login and register forms share one consistent control (and a11y labels).
 */
export function PasswordToggle({
	show,
	onToggle,
	labelShow,
	labelHide,
}: {
	show: boolean;
	onToggle: () => void;
	labelShow: string;
	labelHide: string;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={show ? labelHide : labelShow}
			aria-pressed={show}
			tabIndex={-1}
			className="absolute right-2.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
			style={{ color: "var(--color-text-muted)" }}
		>
			{show ? (
				<EyeOff aria-hidden="true" className="h-4 w-4" />
			) : (
				<Eye aria-hidden="true" className="h-4 w-4" />
			)}
		</button>
	);
}
