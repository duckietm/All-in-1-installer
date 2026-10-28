// Theme blocks registry — defines all visual blocks that can be themed or hidden per scope.
// Each block has a CSS selector, display name, and optional description.

export interface ThemeBlock {
	id: string;
	label: string;
	description: string;
	/** CSS selector to target this block */
	selector: string;
	/** Whether this block is visible by default */
	defaultVisible: boolean;
	/** Category for grouping in admin UI */
	category: "chrome" | "layout" | "components" | "effects";
}

export const THEME_BLOCKS: ThemeBlock[] = [
	// ─── Chrome (site-wide navigation/branding) ──────────────────────────────
	{
		id: "top_header",
		label: "Top Header",
		description: "Currency bar, user menu, notifications (logged-in users)",
		selector: '[data-theme-block="top_header"]',
		defaultVisible: true,
		category: "chrome",
	},
	{
		id: "site_header",
		label: "Hero Banner",
		description: "Full-width hero banner with background image",
		selector: '[data-theme-block="site_header"]',
		defaultVisible: true,
		category: "chrome",
	},
	{
		id: "navigation",
		label: "Navigation Bar",
		description: "Sticky nav bar with menu items and search",
		selector: '[data-theme-block="navigation"]',
		defaultVisible: true,
		category: "chrome",
	},
	{
		id: "footer",
		label: "Footer",
		description: "Site footer with copyright and CMS info",
		selector: '[data-theme-block="footer"]',
		defaultVisible: true,
		category: "chrome",
	},
	{
		id: "radio_player",
		label: "Radio Player",
		description: "Fixed bottom-right radio player widget",
		selector: '[data-theme-block="radio_player"]',
		defaultVisible: true,
		category: "chrome",
	},

	// ─── Layout blocks ──────────────────────────────────────────────────────
	{
		id: "content_grid",
		label: "Content Grid",
		description: "Main content area with 12-column grid",
		selector: '[data-theme-block="content_grid"]',
		defaultVisible: true,
		category: "layout",
	},
	{
		id: "page_transition",
		label: "Page Transitions",
		description: "AnimatePresence page transition animations",
		selector: '[data-theme-block="page_transition"]',
		defaultVisible: true,
		category: "layout",
	},

	// ─── Component blocks ───────────────────────────────────────────────────
	{
		id: "content_card",
		label: "Content Cards",
		description: "The signature atom card with header and body",
		selector: ".content-card",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "surface_card",
		label: "Surface Cards",
		description: "Alternative card used on login, register, dashboard",
		selector: ".surface-card",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "stat_block",
		label: "Stat Blocks",
		description: "Value + label tiles on profiles and dashboards",
		selector: ".stat-block",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "online_badge",
		label: "Online Badges",
		description: "Online/offline status pills",
		selector: ".online-badge",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "rank_badge",
		label: "Rank Badges",
		description: "Leaderboard rank chips with medal emojis",
		selector: ".rank-badge",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "btn_primary",
		label: "Primary Buttons",
		description: "Main call-to-action buttons",
		selector: ".btn-primary",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "btn_secondary",
		label: "Secondary Buttons",
		description: "Secondary action buttons",
		selector: ".btn-secondary",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "btn_danger",
		label: "Danger Buttons",
		description: "Destructive action buttons",
		selector: ".btn-danger",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "btn_outline",
		label: "Outline Buttons",
		description: "Border-style buttons",
		selector: ".btn-outline",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "dropdown_menu",
		label: "Dropdown Menus",
		description: "Nav dropdowns and user menus",
		selector: ".dropdown-menu",
		defaultVisible: true,
		category: "components",
	},
	{
		id: "empty_state",
		label: "Empty States",
		description: "Friendly empty state placeholders",
		selector: ".empty-state",
		defaultVisible: true,
		category: "components",
	},

	// ─── Effects ────────────────────────────────────────────────────────────
	{
		id: "glass_effect",
		label: "Glassmorphism",
		description: "Frosted glass panels (auth top bar, premium cards)",
		selector: ".glass, .glass-strong",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "card_premium",
		label: "Premium Card Effect",
		description: "Enhanced card with depth and glow",
		selector: ".card-premium",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "gradient_border",
		label: "Gradient Borders",
		description: "Animated gradient border wrappers",
		selector: ".gradient-border",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "animate_float",
		label: "Float Animation",
		description: "Gentle floating animation (Frank character on login)",
		selector: ".animate-float",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "animate_shimmer",
		label: "Shimmer Animation",
		description: "Loading shimmer effect",
		selector: ".animate-shimmer",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "animate_reveal",
		label: "Scroll Reveal",
		description: "Fade-up reveal on scroll (login, register, dashboard)",
		selector: ".motion-reveal",
		defaultVisible: true,
		category: "effects",
	},
	{
		id: "btn_shine",
		label: "Button Shine",
		description: "Premium shine effect on enter button",
		selector: ".btn-shine",
		defaultVisible: true,
		category: "effects",
	},
];

// Quick lookup by ID
export const THEME_BLOCK_MAP = new Map(THEME_BLOCKS.map((b) => [b.id, b]));

// Get blocks grouped by category
export function getBlocksByCategory(): Record<string, ThemeBlock[]> {
	const grouped: Record<string, ThemeBlock[]> = {};
	for (const block of THEME_BLOCKS) {
		if (!grouped[block.category]) grouped[block.category] = [];
		grouped[block.category].push(block);
	}
	return grouped;
}

// Block setting key prefix in ThemeScopeValue
export const BLOCK_KEY_PREFIX = "block:";

// All block setting keys (for a given block id, the key is `block:{id}`)
export function blockSettingKey(blockId: string): string {
	return `${BLOCK_KEY_PREFIX}${blockId}`;
}

// Layout setting keys
export const LAYOUT_KEYS = [
	"layout:max_width",
	"layout:spacing",
	"layout:grid_columns",
	"layout:content_padding",
	"layout:navbar_height",
] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export const LAYOUT_DEFAULTS: Record<LayoutKey, string> = {
	"layout:max_width": "1280px",
	"layout:spacing": "1.5rem",
	"layout:grid_columns": "12",
	"layout:content_padding": "0.75rem",
	"layout:navbar_height": "56px",
};

// Effect setting keys
export const EFFECT_KEYS = [
	"effect:card_shadow",
	"effect:card_shadow_hover",
	"effect:border_style",
	"effect:border_width",
	"effect:transition_duration",
	"effect:animation_scale",
] as const;

export type EffectKey = (typeof EFFECT_KEYS)[number];

export const EFFECT_DEFAULTS: Record<EffectKey, string> = {
	"effect:card_shadow":
		"0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
	"effect:card_shadow_hover":
		"0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.06)",
	"effect:border_style": "solid",
	"effect:border_width": "1px",
	"effect:transition_duration": "200ms",
	"effect:animation_scale": "1",
};

// Media setting keys
export const MEDIA_KEYS = [
	"media:logo_url",
	"media:background_image",
	"media:background_position",
	"media:background_size",
	"media:background_repeat",
] as const;

export type MediaKey = (typeof MEDIA_KEYS)[number];

export const MEDIA_DEFAULTS: Record<MediaKey, string> = {
	"media:logo_url": "",
	"media:background_image": "",
	"media:background_position": "center",
	"media:background_size": "cover",
	"media:background_repeat": "no-repeat",
};

// Custom setting keys
export const CUSTOM_KEYS = ["custom:css", "custom:html"] as const;

export type CustomKey = (typeof CUSTOM_KEYS)[number];
