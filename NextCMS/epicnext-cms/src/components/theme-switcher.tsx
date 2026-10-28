"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Light/dark toggle. The class lives on <html>; theme-init.js applies the
 * saved choice before paint. We sync React state after mount so SSR hydration
 * does not desync from the real DOM class.
 */
export function ThemeSwitcher({
	variant = "nav",
}: {
	variant?: "nav" | "admin";
}) {
	const [dark, setDark] = useState(false);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		setDark(document.documentElement.classList.contains("dark"));
		setReady(true);
	}, []);

	function toggle() {
		const next = !document.documentElement.classList.contains("dark");
		document.documentElement.classList.toggle("dark", next);
		setDark(next);
		try {
			localStorage.setItem("theme", next ? "dark" : "light");
		} catch {
			/* private mode / storage disabled — runtime toggle still works */
		}
	}

	const label = dark ? "Switch to light mode" : "Switch to dark mode";
	const title = dark ? "Light mode" : "Dark mode";

	if (variant === "admin") {
		return (
			<button
				type="button"
				onClick={toggle}
				aria-label={label}
				title={title}
				suppressHydrationWarning
				className="flex-none grid place-items-center w-9 h-9 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] text-[var(--admin-text)] hover:bg-[var(--admin-accent)]/15 hover:text-[var(--admin-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
				style={{ visibility: ready ? "visible" : "hidden" }}
			>
				{dark ? <Sun size={16} /> : <Moon size={16} />}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={toggle}
			className="nav-item cursor-pointer text-lg leading-none px-2"
			aria-label={label}
			title={title}
			suppressHydrationWarning
			style={{ visibility: ready ? "visible" : "hidden" }}
		>
			<span aria-hidden className="text-lg leading-none">
				{dark ? "☀" : "☾"}
			</span>
		</button>
	);
}
