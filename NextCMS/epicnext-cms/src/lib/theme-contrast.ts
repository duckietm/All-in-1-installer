type Rgb = readonly [number, number, number];

export type PublicThemeColors = Record<string, string>;
export interface ContrastPair {
	name: string;
	foreground: string;
	background: string;
}

export interface AdminPalette {
	canvas: string;
	surface: string;
	surfaceElevated: string;
	text: string;
	muted: string;
	border: string;
	accent: string;
	accentText: string;
	accentForeground: string;
	success: string;
	warning: string;
	error: string;
	info: string;
	sidebar: string;
	sidebarText: string;
	overlay: string;
	focusRing: string;
}

/** Pure / near-white public surfaces → soft admin paper (less eye strain). */
export function softLightSurface(
	value: string | undefined,
	softDefault: string,
): string {
	if (!value) return softDefault;
	const v = value.trim().toLowerCase();
	if (v === "#fff" || v === "#ffffff" || v === "white") return softDefault;
	// Common slate/zinc paper whites (#f8fafc, #fafafa, #f9fafb, …)
	if (/^#f[89a-f][0-9a-f]{4}$/i.test(v)) return softDefault;
	return value;
}

export function deriveAdminPalette(
	colors: PublicThemeColors,
	overrides?: Partial<AdminPalette>,
	mode: "light" | "dark" = "dark",
): AdminPalette {
	const accent = overrides?.accent ?? colors.color_primary ?? "#f59e0b";

	// Soft cool gray-blue paper (not pure white) — easier on the eyes in light HK.
	const lightDefaults: AdminPalette = {
		canvas: softLightSurface(colors.color_background, "#eef1f4"),
		surface: softLightSurface(colors.color_surface, "#f5f7fa"),
		surfaceElevated: softLightSurface(colors.color_dropdown, "#fafbfc"),
		text: colors.color_text ?? "#0f172a",
		muted: colors.color_text_muted ?? "#64748b",
		border: "#d8dee6",
		accent,
		accentText: accent,
		accentForeground: "#ffffff",
		success: colors.color_success ?? "#16a34a",
		warning: colors.color_warning ?? "#eab308",
		error: colors.color_error ?? "#ef4444",
		info: colors.color_info ?? "#0ea5e9",
		sidebar: softLightSurface(
			colors.color_navbar ?? colors.color_surface,
			"#e8ecf1",
		),
		sidebarText: colors.color_navbar_text ?? colors.color_text ?? "#0f172a",
		overlay: "rgba(15, 23, 42, 0.45)",
		focusRing: accent,
	};

	const darkDefaults: AdminPalette = {
		canvas: "#0b0f19",
		surface: "#151b27",
		surfaceElevated: "#1e2635",
		text: "#f8fafc",
		muted: "#94a3b8",
		border: "#2a3448",
		accent,
		accentText: "#f59e0b",
		accentForeground: "#ffffff",
		success: "#22c55e",
		warning: "#eab308",
		error: "#ef4444",
		info: "#3b82f6",
		sidebar: "#080c18",
		sidebarText: "#f8fafc",
		overlay: "rgba(2, 6, 23, 0.72)",
		focusRing: accent,
	};

	const defaults = mode === "light" ? lightDefaults : darkDefaults;

	// Staff admin_* overrides are the dark-HK palette — apply only in dark mode
	// so light mode stays readable and tracks the public light theme.
	const merged: AdminPalette = {
		...defaults,
		...(mode === "dark" ? overrides : {}),
		accent,
		overlay:
			mode === "dark"
				? (overrides?.overlay ?? defaults.overlay)
				: defaults.overlay,
		focusRing: accent,
	};

	const surfaces = [
		merged.canvas,
		merged.surface,
		merged.surfaceElevated,
	] as const;
	const preferredText = merged.text;
	const preferredMuted = merged.muted;

	return {
		...merged,
		text: readableColor(preferredText, surfaces),
		muted: readableColor(preferredMuted, [merged.canvas, merged.surface]),
		accentText: readableColor(accent, surfaces),
		accentForeground: readableColor("#ffffff", [accent]),
		sidebarText: readableColor(preferredText, [
			merged.sidebar,
			merged.canvas,
			merged.surface,
		]),
	};
}

export function derivePublicForegrounds(c: PublicThemeColors) {
	const value = (key: string, fallback: string) => c[key] ?? fallback;
	const background = value("color_background", "#f8fafc");
	const surface = value("color_surface", "#ffffff");
	const dropdown = value("color_dropdown", surface);
	const navbar = value("color_navbar", surface);
	const primary = value("color_primary", "#f59e0b");
	const accent = value("color_accent", "#10b981");
	const make = (name: string, preferred: string, bg: string): ContrastPair => ({
		name,
		foreground: readableColor(preferred, [bg]),
		background: bg,
	});
	const pairs = [
		make("body", value("color_text", "#0f172a"), background),
		make("surface", value("color_text", "#0f172a"), surface),
		make("muted", value("color_text_muted", "#64748b"), surface),
		make("subtle", value("color_text_muted", "#64748b"), surface),
		make("disabled", value("color_text_muted", "#64748b"), surface),
		make("sidebar", value("color_navbar_text", "#1e293b"), navbar),
		make("input", value("color_text", "#0f172a"), dropdown),
		make("link", value("link_color", primary), surface),
		make("link-hover", value("link_hover_color", primary), surface),
		make("navbar", value("color_navbar_text", "#1e293b"), navbar),
		make("dropdown", value("color_text", "#0f172a"), dropdown),
		make("primary", value("button_text_color", "#1e293b"), primary),
		make("accent", "#ffffff", accent),
		make(
			"button-primary",
			value("button_text_color", "#1e293b"),
			value("button_primary_color", primary),
		),
		make(
			"button-secondary",
			value("button_secondary_text_color", "#ffffff"),
			value("button_secondary_color", "#22c55e"),
		),
		make(
			"button-danger",
			value("button_danger_text_color", "#ffffff"),
			value("button_danger_color", "#ef4444"),
		),
		make(
			"button-outline",
			value("button_outline_text_color", "#1a1a2e"),
			surface,
		),
		make("pill", value("color_text", "#0f172a"), surface),
		make("badge", value("button_text_color", "#1e293b"), primary),
		make("overlay", "#ffffff", "#111827"),
		...(["success", "warning", "error", "info"] as const).flatMap((status) => {
			const statusColor = value(`color_${status}`, "#0f172a");
			return [
				make(`${status}-text`, statusColor, surface),
				make(`${status}-solid`, "#ffffff", statusColor),
			];
		}),
	];
	return {
		pairs,
		byName: Object.fromEntries(
			pairs.map((pair) => [pair.name, pair.foreground]),
		),
	};
}

export function contrastRatio(
	foreground: string,
	background: string,
): number | null {
	const fg = parseHex(foreground);
	const bg = parseHex(background);
	if (!fg || !bg) return null;

	const light = Math.max(relativeLuminance(fg), relativeLuminance(bg));
	const dark = Math.min(relativeLuminance(fg), relativeLuminance(bg));
	return (light + 0.05) / (dark + 0.05);
}

export function readableColor(
	preferred: string,
	backgrounds: readonly string[],
	minimumRatio = 4.5,
): string {
	const preferredRatios = backgrounds.map((background) =>
		contrastRatio(preferred, background),
	);
	if (preferredRatios.some((ratio) => ratio === null)) return preferred;
	if (preferredRatios.every((ratio) => (ratio as number) >= minimumRatio))
		return preferred;

	const candidates = ["#000000", "#ffffff"] as const;
	return candidates
		.map((color) => ({
			color,
			minimum: Math.min(
				...backgrounds.map(
					(background) => contrastRatio(color, background) ?? 0,
				),
			),
		}))
		.sort((a, b) => b.minimum - a.minimum)[0].color;
}

/** Auto-fix foreground hex keys so saved custom themes stay readable. */
export function ensureReadableThemeColors(
	colors: Record<string, string>,
): Record<string, string> {
	const out = { ...colors };
	const fix = (fgKey: string, bgKeys: readonly string[]) => {
		const preferred = out[fgKey];
		if (!preferred) return;
		const backgrounds = bgKeys
			.map((key) => out[key])
			.filter((value): value is string => Boolean(value));
		if (backgrounds.length === 0) return;
		out[fgKey] = readableColor(preferred, backgrounds);
	};

	fix("color_text", ["color_surface", "color_background"]);
	fix("color_text_muted", ["color_surface", "color_background"]);
	fix("color_navbar_text", ["color_navbar"]);
	fix("button_text_color", ["button_primary_color", "color_primary"]);
	fix("button_secondary_text_color", ["button_secondary_color"]);
	fix("button_danger_text_color", ["button_danger_color"]);
	fix("button_outline_text_color", ["color_surface", "color_background"]);
	fix("link_color", ["color_surface", "color_background"]);
	fix("link_hover_color", ["color_surface", "color_background"]);
	fix("admin_text", ["admin_canvas", "admin_surface"]);
	fix("admin_text_muted", ["admin_canvas", "admin_surface"]);

	return out;
}

export function parseHex(value: string): Rgb | null {
	const trimmed = value.trim();
	const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
	if (short) {
		const [r, g, b] = short[1].split("");
		return [
			Number.parseInt(r + r, 16),
			Number.parseInt(g + g, 16),
			Number.parseInt(b + b, 16),
		];
	}
	const match = /^#([0-9a-f]{6})$/i.exec(trimmed);
	if (!match) return null;
	return [
		Number.parseInt(match[1].slice(0, 2), 16),
		Number.parseInt(match[1].slice(2, 4), 16),
		Number.parseInt(match[1].slice(4, 6), 16),
	];
}

export function relativeLuminance(rgb: Rgb): number {
	const [red, green, blue] = rgb.map((channel) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
