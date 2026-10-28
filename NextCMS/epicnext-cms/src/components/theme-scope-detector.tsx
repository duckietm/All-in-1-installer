"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { detectModule } from "@/lib/theme-modules";

/**
 * Sets data-theme-module and data-theme-route attributes on <html>
 * based on the current pathname. This enables scoped CSS overrides
 * from ScopedThemeVars.
 */
export function ThemeScopeDetector() {
	const pathname = usePathname();

	useEffect(() => {
		const moduleId = detectModule(pathname);
		const html = document.documentElement;

		if (moduleId) {
			html.setAttribute("data-theme-module", moduleId);
		} else {
			html.removeAttribute("data-theme-module");
		}

		html.setAttribute("data-theme-route", pathname);
	}, [pathname]);

	return null;
}
