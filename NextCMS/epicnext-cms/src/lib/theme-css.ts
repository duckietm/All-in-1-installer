import {
	type AdminPalette,
	deriveAdminPalette,
	derivePublicForegrounds,
	readableColor,
} from "@/lib/theme-contrast";
import type { ThemePalette } from "@/lib/theme-presets";

const CSS_VARIABLES: Record<keyof ThemePalette, string> = {
	color_primary: "color-primary",
	color_background: "color-background",
	color_surface: "color-surface",
	color_dropdown: "color-dropdown",
	color_navbar: "color-navbar",
	color_navbar_text: "color-navbar-text",
	color_text: "color-text",
	color_text_muted: "color-text-muted",
	color_accent: "color-accent",
	color_success: "color-success",
	color_warning: "color-warning",
	color_error: "color-error",
	color_info: "color-info",
	button_primary_color: "button-color",
	button_text_color: "button-text-color",
	button_secondary_color: "button-secondary-color",
	button_secondary_text_color: "button-secondary-text-color",
	button_danger_color: "button-danger-color",
	button_danger_text_color: "button-danger-text-color",
	button_outline_color: "button-outline-color",
	button_outline_text_color: "button-outline-text-color",
	link_color: "link-color",
	link_hover_color: "link-hover-color",
	border_color: "border-color",
	panel_border_color: "panel-border-color",
	gradient_from: "gradient-from",
	gradient_to: "gradient-to",
};

export function adminPaletteCss(admin: AdminPalette): string {
	const parts: string[] = [
		`--admin-sidebar-background:${admin.sidebar};`,
		`--admin-sidebar-text-readable:${admin.sidebarText};`,
		`--admin-sidebar-muted-readable:color-mix(in srgb, var(--admin-sidebar-text-readable) 60%, transparent);`,
		`--admin-input-text-readable:${admin.text};`,
		`--admin-canvas:${admin.canvas};`,
		`--admin-surface:${admin.surface};`,
		`--admin-surface-elevated:${admin.surfaceElevated};`,
		`--admin-text:${admin.text};`,
		`--admin-text-readable:${admin.text};`,
		`--admin-text-muted:${admin.muted};`,
		`--admin-text-muted-readable:${admin.muted};`,
		`--admin-border:${admin.border};`,
		`--admin-accent:${admin.accent};`,
		`--admin-accent-text:${admin.accentText};`,
		`--admin-accent-foreground:${admin.accentForeground};`,
		`--admin-success:${admin.success};`,
		`--admin-warning:${admin.warning};`,
		`--admin-error:${admin.error};`,
		`--admin-info:${admin.info};`,
		`--admin-sidebar:${admin.sidebar};`,
		`--admin-sidebar-text:${admin.sidebarText};`,
		`--admin-overlay:${admin.overlay};`,
		`--admin-focus-ring:${admin.focusRing};`,
		...(["success", "warning", "error", "info"] as const).flatMap((status) => [
			`--admin-${status}-foreground:${readableColor("#ffffff", [admin[status]])};`,
			`--admin-${status}-subtle:color-mix(in srgb, ${admin[status]} 14%, ${admin.surface});`,
			`--admin-${status}-border:color-mix(in srgb, ${admin[status]} 38%, transparent);`,
		]),
	];
	return parts.join("");
}

export function themePaletteCss(
	selector: string,
	palette: ThemePalette,
	adminOverrides?: Partial<AdminPalette>,
): string {
	const mode: "light" | "dark" = selector.includes("dark") ? "dark" : "light";
	const semantic = derivePublicForegrounds(palette);
	const admin = deriveAdminPalette(
		palette,
		mode === "dark" ? adminOverrides : undefined,
		mode,
	);
	const declarations = Object.entries(CSS_VARIABLES).map(
		([key, cssName]) => `--${cssName}:${palette[key as keyof ThemePalette]};`,
	);
	declarations.push(
		`--color-text-readable:${readableColor(palette.color_text, [palette.color_background, palette.color_surface])};`,
		`--color-text-muted-readable:${readableColor(palette.color_text_muted, [palette.color_background, palette.color_surface])};`,
		`--color-primary-readable:${readableColor(palette.color_primary, [palette.color_background, palette.color_surface])};`,
		`--color-accent-readable:${readableColor(palette.color_accent, [palette.color_background, palette.color_surface])};`,
		`--color-primary-foreground-readable:${semantic.byName.primary};`,
		`--color-accent-foreground-readable:${semantic.byName.accent};`,
		`--color-navbar-text-readable:${semantic.byName.navbar};`,
		`--button-text-color-readable:${semantic.byName["button-primary"]};`,
		`--button-secondary-text-color-readable:${semantic.byName["button-secondary"]};`,
		`--button-danger-text-color-readable:${semantic.byName["button-danger"]};`,
		`--button-outline-text-color-readable:${semantic.byName["button-outline"]};`,
		`--link-color-readable:${semantic.byName.link};`,
		`--link-hover-color-readable:${semantic.byName["link-hover"]};`,
		`--color-surface-text-readable:${semantic.byName.surface};`,
		`--color-dropdown-text-readable:${semantic.byName.dropdown};`,
		`--color-pill-text-readable:${semantic.byName.pill};`,
		`--color-badge-text-readable:${semantic.byName.badge};`,
		`--color-overlay-text-readable:${semantic.byName.overlay};`,
		`--color-text-subtle-readable:${semantic.byName.subtle};`,
		`--color-text-disabled-readable:${semantic.byName.disabled};`,
		...(["success", "warning", "error", "info"] as const).flatMap((status) => [
			`--color-${status}-text-readable:${semantic.byName[`${status}-text`]};`,
			`--color-${status}-foreground-readable:${semantic.byName[`${status}-solid`]};`,
			`--color-${status}-subtle:color-mix(in srgb, ${palette[`color_${status}`]} 14%, ${palette.color_surface});`,
			`--color-${status}-border:color-mix(in srgb, ${palette[`color_${status}`]} 38%, transparent);`,
		]),
		adminPaletteCss(admin),
	);
	return `${selector}{${declarations.join("")}}`;
}
