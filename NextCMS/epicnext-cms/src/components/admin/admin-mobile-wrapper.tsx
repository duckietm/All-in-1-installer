"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const AdminMobileContext = createContext<{ close: () => void }>({
	close: () => {},
});

export function useAdminMobile() {
	return useContext(AdminMobileContext);
}

export function AdminMobileWrapper({
	sidebar,
	children,
}: {
	sidebar: ReactNode;
	children: ReactNode;
}) {
	const t = useTranslations("pages.admin.nav");
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const mobile = useMemo(() => ({ close }), [close]);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [open]);

	return (
		<AdminMobileContext.Provider value={mobile}>
			{/* Wider than public max-w-7xl (80rem), capped so it never goes full-bleed. */}
			<div className="h-dvh overflow-hidden bg-[var(--admin-canvas)]">
				<div className="mx-auto flex h-full min-h-0 w-full max-w-full min-w-0 flex-col lg:max-w-[96rem] lg:flex-row lg:border-x lg:shadow-xl border-[var(--admin-border)]">
					{/* Mobile header */}
					<div
						className={`lg:hidden shrink-0 flex items-center gap-3 px-4 py-3 border-b ${
							open ? "z-30" : "z-50"
						}`}
						style={{
							backgroundColor: "var(--admin-sidebar-background)",
							borderColor: "var(--admin-border)",
						}}
					>
						<button
							type="button"
							onClick={() => setOpen(!open)}
							aria-label={t(open ? "closeSidebar" : "openSidebar")}
							aria-expanded={open}
							aria-controls="admin-sidebar-panel"
							className="flex items-center justify-center w-9 h-9 rounded-lg
						focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--admin-sidebar-background)]"
							style={{ color: "var(--admin-sidebar-text-readable)" }}
						>
							{open ? <X size={18} /> : <Menu size={18} />}
						</button>
						<span
							className="text-sm font-bold"
							style={{ color: "var(--admin-sidebar-text-readable)" }}
						>
							{t("housekeeping")}
						</span>
					</div>

					{/* Backdrop */}
					{open && (
						<button
							type="button"
							aria-label={t("closeSidebar")}
							className="fixed inset-0 z-40 lg:hidden"
							onClick={() => setOpen(false)}
							style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
						/>
					)}

					{/* Sidebar */}
					<div
						id="admin-sidebar-panel"
						className={`fixed inset-y-0 left-0 z-50 flex h-full w-[260px] flex-col overflow-hidden lg:!relative lg:shrink-0 lg:!translate-x-0 ${
							open ? "translate-x-0" : "-translate-x-full"
						}`}
						style={{ transition: "transform 300ms ease-in-out" }}
					>
						{sidebar}
					</div>

					{/* Content */}
					<div
						data-admin-content
						className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
					>
						{children}
					</div>
				</div>
			</div>
		</AdminMobileContext.Provider>
	);
}
