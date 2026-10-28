"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { createPortal } from "react-dom";
import { setLocaleCookie } from "@/actions/set-locale";

const LOCALES: { code: string; label: string; lang: string }[] = [
	{ code: "nl", label: "Nederlands", lang: "nl" },
	{ code: "en", label: "English", lang: "en" },
	{ code: "de", label: "Deutsch", lang: "de" },
	{ code: "fr", label: "Français", lang: "fr" },
	{ code: "es", label: "Español", lang: "es" },
	{ code: "it", label: "Italiano", lang: "it" },
	{ code: "pt", label: "Português", lang: "pt" },
	{ code: "pl", label: "Polski", lang: "pl" },
	{ code: "sv", label: "Svenska", lang: "sv" },
	{ code: "tr", label: "Türkçe", lang: "tr" },
	{ code: "ro", label: "Română", lang: "ro" },
	{ code: "hu", label: "Magyar", lang: "hu" },
	{ code: "cs", label: "Čeština", lang: "cs" },
	{ code: "sk", label: "Slovenčina", lang: "sk" },
	{ code: "da", label: "Dansk", lang: "da" },
	{ code: "no", label: "Norsk", lang: "no" },
	{ code: "el", label: "Ελληνικά", lang: "el" },
	{ code: "bg", label: "Български", lang: "bg" },
	{ code: "hr", label: "Hrvatski", lang: "hr" },
	{ code: "sr", label: "Српски", lang: "sr" },
	{ code: "uk", label: "Українська", lang: "uk" },
	{ code: "ru", label: "Русский", lang: "ru" },
];

const MENU_WIDTH = 224; // w-56
const MENU_GAP = 6;
const VIEWPORT_PAD = 8;

export function LanguageSwitcher({
	variant = "nav",
}: {
	variant?: "nav" | "admin";
}) {
	const locale = useLocale();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
		null,
	);
	const [mounted, setMounted] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
	const isAdmin = variant === "admin";

	const filtered = useMemo(() => {
		if (!search) return LOCALES;
		const q = search.toLowerCase();
		return LOCALES.filter(
			(l) =>
				l.label.toLowerCase().includes(q) ||
				l.code.toLowerCase().includes(q) ||
				l.lang.toLowerCase().includes(q),
		);
	}, [search]);

	useEffect(() => {
		setMounted(true);
	}, []);

	useLayoutEffect(() => {
		if (!open) {
			setMenuPos(null);
			return;
		}

		function place() {
			const trigger = triggerRef.current;
			if (!trigger) return;
			const rect = trigger.getBoundingClientRect();
			const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_PAD;
			const left = Math.min(
				Math.max(VIEWPORT_PAD, rect.right - MENU_WIDTH),
				Math.max(VIEWPORT_PAD, maxLeft),
			);
			setMenuPos({ top: rect.bottom + MENU_GAP, left });
		}

		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			const t = e.target as Node;
			if (triggerRef.current?.contains(t) || menuRef.current?.contains(t))
				return;
			setOpen(false);
		}
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			setSearch("");
			return;
		}
		const id = window.setTimeout(() => searchRef.current?.focus(), 0);
		return () => window.clearTimeout(id);
	}, [open]);

	function switchLocale(code: string) {
		if (code === locale) {
			setOpen(false);
			return;
		}
		startTransition(async () => {
			await setLocaleCookie(code);
			router.refresh();
		});
		setOpen(false);
	}

	const menu = open && menuPos && mounted && (
		<div
			ref={menuRef}
			role="listbox"
			aria-label="Languages"
			style={{
				position: "fixed",
				top: menuPos.top,
				left: menuPos.left,
				width: MENU_WIDTH,
				zIndex: 200,
			}}
			className={
				isAdmin
					? "overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] text-[var(--admin-text)] shadow-xl"
					: "dropdown-menu overflow-hidden rounded-xl z-50 shadow-xl"
			}
		>
			<div
				className={
					isAdmin
						? "border-b border-[var(--admin-border)] p-2"
						: "border-b border-black/10 dark:border-white/10 p-2"
				}
			>
				<label
					className={
						isAdmin
							? "flex min-w-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-2.5 py-1.5"
							: "flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5"
					}
				>
					<Search
						className={`h-3.5 w-3.5 shrink-0 ${isAdmin ? "text-[var(--admin-text-muted)]" : "text-muted-foreground"}`}
						aria-hidden
					/>
					<input
						ref={searchRef}
						type="text"
						placeholder="Search…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						aria-label="Search languages"
						className={
							isAdmin
								? "min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-[var(--admin-text)] outline-none shadow-none focus:border-0 focus:shadow-none focus:ring-0 placeholder:text-[var(--admin-text-muted)]"
								: "min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none shadow-none focus:border-0 focus:shadow-none focus:ring-0"
						}
					/>
				</label>
			</div>

			<div className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
				{filtered.length === 0 && (
					<p
						className={`px-2 py-6 text-center text-xs ${isAdmin ? "text-[var(--admin-text-muted)]" : "text-muted-foreground"}`}
					>
						No languages found
					</p>
				)}
				{filtered.map((l) => {
					const selected = l.code === locale;
					return (
						<button
							key={l.code}
							type="button"
							role="option"
							aria-selected={selected}
							onClick={() => switchLocale(l.code)}
							className={
								isAdmin
									? `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors border-0 cursor-pointer ${
											selected
												? "bg-[var(--admin-accent)]/18 text-[var(--admin-accent)] font-semibold"
												: "bg-transparent text-[var(--admin-text)] hover:bg-[var(--admin-accent)]/10"
										}`
									: `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors border-0 cursor-pointer ${
											selected ? "opacity-100" : "opacity-70 hover:opacity-100"
										}`
							}
							style={
								isAdmin
									? undefined
									: {
											color: "var(--color-text-readable, var(--color-text))",
											background: selected
												? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
												: "transparent",
										}
							}
						>
							<Image
								src={`/assets/images/icons/flags/${l.code}.png`}
								alt=""
								width={16}
								height={16}
								className="inline-block h-4 w-auto shrink-0"
							/>
							<span className="min-w-0 flex-1 truncate">{l.label}</span>
							{selected ? (
								<Check
									className={`h-3.5 w-3.5 shrink-0 ${isAdmin ? "text-[var(--admin-accent)]" : "opacity-80"}`}
									aria-hidden
								/>
							) : (
								<span className="w-3.5 shrink-0" aria-hidden />
							)}
						</button>
					);
				})}
			</div>
		</div>
	);

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				disabled={pending}
				aria-label={`Change language — ${current.code.toUpperCase()}`}
				title="Language"
				aria-expanded={open}
				aria-haspopup="listbox"
				className={
					isAdmin
						? "flex items-center gap-1.5 h-9 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] px-2.5 text-xs font-bold uppercase tracking-wide text-[var(--admin-text)] hover:bg-[var(--admin-accent)]/15 hover:text-[var(--admin-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] disabled:opacity-60"
						: "nav-item flex items-center gap-1.5 bg-transparent text-[13px] border-none cursor-pointer px-1"
				}
			>
				<Image
					src={`/assets/images/icons/flags/${current.code}.png`}
					alt=""
					width={16}
					height={16}
					className="inline-block h-4 w-auto"
				/>
				<span>{current.code.toUpperCase()}</span>
				<ChevronDown
					className={`h-3 w-3 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
					aria-hidden
				/>
			</button>

			{mounted && menu ? createPortal(menu, document.body) : null}
		</div>
	);
}
