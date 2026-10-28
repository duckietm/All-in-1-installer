// Site background settings shared by the Theme Manager, its server actions,
// and ThemeVars. Kept in a plain module because it is imported by client
// components and "use server" files.

export const BACKGROUND_KEYS = [
	"background_image",
	"background_position",
	"background_size",
	"background_repeat",
	"background_effect",
	"background_overlay",
	"background_overlay_opacity",
] as const;
export type BackgroundKey = (typeof BACKGROUND_KEYS)[number];

/**
 * Animated background effects rendered behind the public site. Purely
 * decorative and CSS-driven (transform/opacity only) so they stay cheap on
 * every device and respect `prefers-reduced-motion`.
 */
export const BACKGROUND_EFFECTS = [
	"none",
	"aurora",
	"particles",
	"aurora-particles",
] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

export const BACKGROUND_EFFECT_DEFAULT: BackgroundEffect = "none";

export const OVERLAY_PRESETS = [
	{ label: "None", value: "" },
	{ label: "Black", value: "#000000" },
	{ label: "White", value: "#ffffff" },
	{ label: "Navy", value: "#0b1220" },
	{ label: "Slate", value: "#1e293b" },
] as const;

export const OVERLAY_OPACITY_MAX = 90;

export const BACKGROUND_POSITIONS = [
	"center center",
	"top center",
	"top left",
	"top right",
	"center left",
	"center right",
	"bottom center",
	"bottom left",
	"bottom right",
] as const;

export const BACKGROUND_SIZES = ["cover", "contain", "auto"] as const;

export const BACKGROUND_REPEATS = [
	"no-repeat",
	"repeat",
	"repeat-x",
	"repeat-y",
] as const;

export const BACKGROUND_DEFAULTS: Record<BackgroundKey, string> = {
	background_image: "",
	background_position: "center center",
	background_size: "cover",
	background_repeat: "no-repeat",
	background_effect: BACKGROUND_EFFECT_DEFAULT,
	background_overlay: "",
	background_overlay_opacity: "0",
};

/**
 * A URL accepted as a custom site background. Blocks `javascript:`, data
 * URIs and any character that could break out of CSS `url("...")` (quotes,
 * backslashes, backticks, whitespace).
 */
export function isSafeBackgroundUrl(value: string): boolean {
	const URL_SAFE = /^[a-zA-Z0-9/:_\-.?&=%~+#]+$/;
	return (
		(value.startsWith("/") || /^https?:\/\/[^\s"'`\\]+$/i.test(value)) &&
		URL_SAFE.test(value)
	);
}
