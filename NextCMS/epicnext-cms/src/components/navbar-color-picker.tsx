"use client";

import { useEffect, useState } from "react";

const COLORS = [
	{ name: "Wit", value: "#ffffff", text: "#1e293b" },
	{ name: "Zwart", value: "#0f172a", text: "#f8fafc" },
	{ name: "Donker", value: "#1e293b", text: "#f8fafc" },
	{ name: "Grijs", value: "#f1f5f9", text: "#1e293b" },
	{ name: "Zilvergrijs", value: "#94a3b8", text: "#1e293b" },
	{ name: "Leisteen", value: "#475569", text: "#f8fafc" },
	{ name: "Bruin", value: "#92400e", text: "#f8fafc" },
	{ name: "Koper", value: "#b45309", text: "#f8fafc" },
	{ name: "Amber", value: "#f59e0b", text: "#1e293b" },
	{ name: "Goud", value: "#eab308", text: "#1e293b" },
	{ name: "Oranje", value: "#ea580c", text: "#ffffff" },
	{ name: "Rood", value: "#ef4444", text: "#ffffff" },
	{ name: "Bordeaux", value: "#991b1b", text: "#f8fafc" },
	{ name: "Roze", value: "#ec4899", text: "#ffffff" },
	{ name: "Fuchsia", value: "#d946ef", text: "#ffffff" },
	{ name: "Paars", value: "#8b5cf6", text: "#ffffff" },
	{ name: "Violet", value: "#6d28d9", text: "#f8fafc" },
	{ name: "Indigo", value: "#6366f1", text: "#ffffff" },
	{ name: "Blauw", value: "#3b82f6", text: "#ffffff" },
	{ name: "Koningsblauw", value: "#1d4ed8", text: "#ffffff" },
	{ name: "Cyaan", value: "#06b6d4", text: "#ffffff" },
	{ name: "Mint", value: "#14b8a6", text: "#ffffff" },
	{ name: "Groen", value: "#22c55e", text: "#1e293b" },
	{ name: "Olijf", value: "#84cc16", text: "#1e293b" },
	{ name: "Limoen", value: "#65a30d", text: "#ffffff" },
];

export function NavbarColorPicker() {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(() => {
		if (typeof window === "undefined") return 0;
		const saved = localStorage.getItem("navbarColor");
		if (!saved) return 0;
		return Math.max(
			0,
			COLORS.findIndex((c) => c.value === saved),
		);
	});
	const [mounted, setMounted] = useState(false);

	function apply(index: number) {
		// index validated by findIndex + Math.max, guard below
		const c = COLORS[index];
		if (!c) return;
		document.documentElement.style.setProperty("--color-navbar", c.value);
		document.documentElement.style.setProperty("--color-navbar-text", c.text);
		document.documentElement.style.setProperty(
			"--color-navbar-text-readable",
			c.text,
		);
		try {
			localStorage.setItem("navbarColor", c.value);
			localStorage.setItem("navbarTextColor", c.text);
		} catch {}
		setActive(index);
		setOpen(false);
	}

	useEffect(() => {
		const saved = localStorage.getItem("navbarColor");
		const savedText = localStorage.getItem("navbarTextColor");
		if (saved) {
			document.documentElement.style.setProperty("--color-navbar", saved);
		}
		if (savedText) {
			document.documentElement.style.setProperty(
				"--color-navbar-text",
				savedText,
			);
			document.documentElement.style.setProperty(
				"--color-navbar-text-readable",
				savedText,
			);
		}
		setMounted(true);
	}, []);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="nav-item cursor-pointer px-2"
				aria-label="Navbar kleur"
				title="Navbar kleur"
			>
				<svg
					className="w-4 h-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					role="img"
					aria-label="Navbar kleur"
				>
					<title>Navbar kleur</title>
					<circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
					<circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
					<circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
					<circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
					<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-10-10-10z" />
				</svg>
			</button>

			{mounted && open && (
				<div className="dropdown-menu absolute right-0 top-full mt-0.5 min-w-[240px] sm:min-w-[280px] rounded-xl z-50 py-3 px-2">
					<div
						className="text-xs font-semibold uppercase tracking-wider mb-2 px-2"
						style={{ color: "var(--color-text-muted)" }}
					>
						Navbar kleur
					</div>
					<div className="grid grid-cols-5 gap-1.5">
						{COLORS.map((c, i) => (
							<button
								key={c.name}
								type="button"
								onClick={() => apply(i)}
								className="flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all duration-100"
								title={c.name}
								style={{
									background:
										i === active
											? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
											: "transparent",
									border: "none",
									cursor: "pointer",
								}}
								onMouseEnter={(e) => {
									if (i !== active)
										e.currentTarget.style.backgroundColor =
											"color-mix(in srgb, var(--color-text-muted) 8%, transparent)";
								}}
								onMouseLeave={(e) => {
									if (i !== active)
										e.currentTarget.style.backgroundColor = "transparent";
								}}
							>
								<span
									className="block w-6 h-6 rounded-full border-2 shrink-0"
									style={{
										backgroundColor: c.value,
										borderColor:
											i === active
												? "var(--color-primary)"
												: "color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
									}}
								/>
								<span
									className="text-[10px] font-medium leading-tight text-center"
									style={{ color: "var(--color-text-muted)" }}
								>
									{c.name}
								</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
