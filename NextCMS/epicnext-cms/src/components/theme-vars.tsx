import type { CSSProperties } from "react";
import { publicAssetExists } from "@/lib/public-asset";
import { siteSettings } from "@/lib/services/site-settings";
import {
	BACKGROUND_DEFAULTS,
	BACKGROUND_EFFECTS,
	BACKGROUND_POSITIONS,
	BACKGROUND_REPEATS,
	BACKGROUND_SIZES,
	type BackgroundEffect,
	isSafeBackgroundUrl,
} from "@/lib/theme-bg";
import { themePaletteCss } from "@/lib/theme-css";
import {
	FONTS,
	PRESETS,
	THEME_COLOR_KEYS,
	type ThemePalette,
} from "@/lib/theme-presets";

// Injects the DB-driven CSS custom properties into :root / html.dark.
// Readable (WCAG) text colors are derived centrally in themePaletteCss.

// Deterministic particle layout (stable keys, no random state per render).
const PARTICLE_DOTS = Array.from({ length: 14 }, (_, i) => ({
	key: `site-backdrop-dot-${i}`,
	left: Math.round(((i * 7.13 + 3) % 100) * 100) / 100,
	duration: 10 + (i % 5) * 1.7,
	delay: (i % 8) * -1.9,
	drift: ((i % 3) - 1) * 2.2,
	size: 3 + (i % 3),
	alpha: Math.round((0.35 + (i % 4) * 0.12) * 100) / 100,
}));

export async function ThemeVars({ nonce }: { nonce?: string } = {}) {
	const g = (k: string, d: string) => siteSettings.get(k, d);
	const [
		primary,
		background,
		surface,
		dropdown,
		navbar,
		navbarText,
		text,
		textMuted,
		accent,
		success,
		warning,
		error,
		info,
		buttonColor,
		buttonText,
		buttonSecondary,
		buttonSecondaryText,
		buttonDanger,
		buttonDangerText,
		buttonOutline,
		buttonOutlineText,
		linkColor,
		linkHover,
		borderColor,
		panelBorderColor,
		gradientFrom,
		gradientTo,
		borderRadius,
		fontKey,
		h1,
		h2,
		h3,
		customCss,
		adminCanvas,
		adminSurface,
		adminText,
		adminTextMuted,
		adminBorder,
		adminSidebarBg,
		backgroundImage,
		backgroundPosition,
		backgroundSize,
		backgroundRepeat,
		backgroundEffect,
		backgroundOverlay,
		backgroundOverlayOpacity,
	] = await Promise.all([
		g("color_primary", "#f59e0b"),
		g("color_background", "#f8fafc"),
		g("color_surface", "#ffffff"),
		g("color_dropdown", "#ffffff"),
		g("color_navbar", "#ffffff"),
		g("color_navbar_text", "#1e293b"),
		g("color_text", "#0f172a"),
		g("color_text_muted", "#64748b"),
		g("color_accent", "#10b981"),
		g("color_success", "#16a34a"),
		g("color_warning", "#eab308"),
		g("color_error", "#ef4444"),
		g("color_info", "#0ea5e9"),
		g("button_primary_color", "#f59e0b"),
		g("button_text_color", "#1e293b"),
		g("button_secondary_color", "#22c55e"),
		g("button_secondary_text_color", "#ffffff"),
		g("button_danger_color", "#ef4444"),
		g("button_danger_text_color", "#ffffff"),
		g("button_outline_color", "#eeb425"),
		g("button_outline_text_color", "#1a1a2e"),
		g("link_color", "#eeb425"),
		g("link_hover_color", "#cf9d15"),
		g("border_color", "#eeb425"),
		g("panel_border_color", "#e9b124"),
		g("gradient_from", "#f59e0b"),
		g("gradient_to", "#10b981"),
		g("border_radius", "12"),
		g("font_family", "nunito"),
		g("size_heading_h1", "30"),
		g("size_heading_h2", "22"),
		g("size_heading_h3", "18"),
		g("custom_css", ""),
		g("admin_canvas", ""),
		g("admin_surface", ""),
		g("admin_text", ""),
		g("admin_text_muted", ""),
		g("admin_border", ""),
		g("admin_sidebar_bg", ""),
		g("background_image", BACKGROUND_DEFAULTS.background_image),
		g("background_position", BACKGROUND_DEFAULTS.background_position),
		g("background_size", BACKGROUND_DEFAULTS.background_size),
		g("background_repeat", BACKGROUND_DEFAULTS.background_repeat),
		g("background_effect", BACKGROUND_DEFAULTS.background_effect),
		g("background_overlay", BACKGROUND_DEFAULTS.background_overlay),
		g(
			"background_overlay_opacity",
			BACKGROUND_DEFAULTS.background_overlay_opacity,
		),
	]);

	// Only hex/keyword color values are admin-controlled — sanitize defensively.
	const safe = (v: string | null, d: string) =>
		v && /^[#a-zA-Z0-9(),.\s%-]+$/.test(v) ? v : d;
	const px = (v: string | null, d: string) =>
		/^\d{1,3}$/.test(v ?? "") ? (v as string) : d;

	const lightPalette = {
		color_primary: safe(primary, "#f59e0b"),
		color_background: safe(background, "#f8fafc"),
		color_surface: safe(surface, "#ffffff"),
		color_dropdown: safe(dropdown, "#ffffff"),
		color_navbar: safe(navbar, "#ffffff"),
		color_navbar_text: safe(navbarText, "#1e293b"),
		color_text: safe(text, "#0f172a"),
		color_text_muted: safe(textMuted, "#64748b"),
		color_accent: safe(accent, "#10b981"),
		color_success: safe(success, "#16a34a"),
		color_warning: safe(warning, "#eab308"),
		color_error: safe(error, "#ef4444"),
		color_info: safe(info, "#0ea5e9"),
		button_primary_color: safe(buttonColor, "#f59e0b"),
		button_text_color: safe(buttonText, "#1e293b"),
		button_secondary_color: safe(buttonSecondary, "#22c55e"),
		button_secondary_text_color: safe(buttonSecondaryText, "#ffffff"),
		button_danger_color: safe(buttonDanger, "#ef4444"),
		button_danger_text_color: safe(buttonDangerText, "#ffffff"),
		button_outline_color: safe(buttonOutline, "#eeb425"),
		button_outline_text_color: safe(buttonOutlineText, "#1a1a2e"),
		link_color: safe(linkColor, "#eeb425"),
		link_hover_color: safe(linkHover, "#cf9d15"),
		border_color: safe(borderColor, "#eeb425"),
		panel_border_color: safe(panelBorderColor, "#e9b124"),
		gradient_from: safe(gradientFrom, "#f59e0b"),
		gradient_to: safe(gradientTo, "#10b981"),
	} satisfies ThemePalette;

	const adminOverrides = {
		...(adminCanvas ? { canvas: safe(adminCanvas, "#0b0f19") } : {}),
		...(adminSurface ? { surface: safe(adminSurface, "#151b27") } : {}),
		...(adminText ? { text: safe(adminText, "#f8fafc") } : {}),
		...(adminTextMuted ? { muted: safe(adminTextMuted, "#94a3b8") } : {}),
		...(adminBorder ? { border: safe(adminBorder, "#2a3448") } : {}),
		...(adminSidebarBg ? { sidebar: safe(adminSidebarBg, "#080c18") } : {}),
	};

	const font = FONTS[fontKey ?? "nunito"] ?? FONTS.nunito;

	const presetName =
		(await g("theme_preset", "Atom (golden)")) ?? "Atom (golden)";
	const preset = PRESETS[presetName] ?? PRESETS["Atom (golden)"];
	const darkPalette = Object.fromEntries(
		await Promise.all(
			THEME_COLOR_KEYS.map(
				async (key) =>
					[
						key,
						safe(await g(`${key}_dark`, preset.dark[key]), preset.dark[key]),
					] as const,
			),
		),
	) as ThemePalette;

	const typography = [
		`--border-radius:${px(borderRadius, "12")}px`,
		`--font-family:${font.stack}`,
		`--size-heading-h1:${px(h1, "30")}px`,
		`--size-heading-h2:${px(h2, "22")}px`,
		`--size-heading-h3:${px(h3, "18")}px`,
	].join(";");

	const lightCss = themePaletteCss(":root", lightPalette, adminOverrides);
	const darkCss = themePaletteCss("html.dark", darkPalette, adminOverrides);
	// Append typography inside :root block.
	const css = `${lightCss.slice(0, -1)}${typography};}${darkCss}`;

	const googleHref = font.google
		? `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`
		: null;

	const safeBgPosition = (BACKGROUND_POSITIONS as readonly string[]).includes(
		backgroundPosition ?? "",
	)
		? backgroundPosition
		: BACKGROUND_DEFAULTS.background_position;
	const safeBgSize = (BACKGROUND_SIZES as readonly string[]).includes(
		backgroundSize ?? "",
	)
		? backgroundSize
		: BACKGROUND_DEFAULTS.background_size;
	const safeBgRepeat = (BACKGROUND_REPEATS as readonly string[]).includes(
		backgroundRepeat ?? "",
	)
		? backgroundRepeat
		: BACKGROUND_DEFAULTS.background_repeat;

	const safeEffect = (BACKGROUND_EFFECTS as readonly string[]).includes(
		backgroundEffect ?? "",
	)
		? (backgroundEffect as BackgroundEffect)
		: BACKGROUND_EFFECTS[0];

	const safeOverlay = /^#[0-9a-fA-F]{3,8}$/.test(backgroundOverlay ?? "")
		? (backgroundOverlay as string)
		: "";
	const overlayPct = /^\d{1,2}$/.test(backgroundOverlayOpacity ?? "")
		? Math.min(parseInt(backgroundOverlayOpacity as string, 10), 90)
		: 0;

	// The wallpaper is painted as the *first* background layer on top of the
	// theme gradient (`--site-bg-gradient`). It used to be the only layer,
	// which meant a missing upload wiped the sky entirely and left the site on
	// flat white. Layering keeps the gradient as a guaranteed fallback.
	//
	// A local wallpaper that no longer exists on disk (deleted upload, stale
	// theme setting) would also fire a 404 on every page view, so only emit the
	// layer when the file is actually there. Remote URLs are trusted as-is.
	const backgroundCss =
		backgroundImage &&
		isSafeBackgroundUrl(backgroundImage) &&
		publicAssetExists(backgroundImage)
			? `body.site-bg{background-image:url("${backgroundImage}"),var(--site-bg-gradient);background-position:${safeBgPosition},center top;background-size:${safeBgSize},cover;background-repeat:${safeBgRepeat},no-repeat}`
			: "";

	const backdropStyle: CSSProperties | undefined = safeOverlay
		? ({
				"--background-overlay": `color-mix(in srgb, ${safeOverlay} ${overlayPct}%, transparent)`,
			} as CSSProperties)
		: undefined;

	return (
		<>
			{googleHref ? <link rel="stylesheet" href={googleHref} /> : null}
			<style nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} />
			{backgroundCss ? (
				<style
					nonce={nonce}
					dangerouslySetInnerHTML={{ __html: backgroundCss }}
				/>
			) : null}
			{customCss?.trim() ? (
				// Staff-authored custom CSS (housekeeping → Theme). Trusted input.
				<style nonce={nonce} dangerouslySetInnerHTML={{ __html: customCss }} />
			) : null}
			{/* Animated site backdrop: aurora + particles + optional tint. Pure
			    decoration, behind the content, hidden in the admin panel. */}
			<div
				className="site-backdrop"
				data-effect={safeEffect}
				aria-hidden="true"
				style={backdropStyle}
			>
				<span className="site-backdrop-aurora">
					<i className="site-backdrop-blob site-backdrop-blob-1" />
					<i className="site-backdrop-blob site-backdrop-blob-2" />
					<i className="site-backdrop-blob site-backdrop-blob-3" />
				</span>
				<span className="site-backdrop-particles">
					{PARTICLE_DOTS.map((dot) => (
						<i
							key={dot.key}
							className="site-backdrop-dot"
							style={
								{
									left: `${dot.left}%`,
									"--dot-duration": `${dot.duration}s`,
									"--dot-delay": `${dot.delay}s`,
									"--dot-drift": `${dot.drift}vw`,
									"--dot-size": dot.size,
									"--dot-alpha": dot.alpha,
								} as CSSProperties
							}
						/>
					))}
				</span>
				<span className="site-backdrop-overlay" />
			</div>
		</>
	);
}
