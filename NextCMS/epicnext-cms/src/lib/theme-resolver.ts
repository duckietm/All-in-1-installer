import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db, ThemeScope, ThemeScopeValue } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";
import {
	BLOCK_KEY_PREFIX,
	EFFECT_DEFAULTS,
	type EffectKey,
	LAYOUT_DEFAULTS,
	type LayoutKey,
	MEDIA_DEFAULTS,
	type MediaKey,
} from "@/lib/theme-blocks";
import { THEME_COLOR_KEYS, type ThemeColorKey } from "@/lib/theme-presets";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeScopeType = "global" | "site" | "module" | "route";

export interface ThemeScopeRow {
	id: number;
	name: string;
	type: ThemeScopeType;
	parentId: number | null;
	siteDomain: string | null;
	routePath: string | null;
	moduleId: string | null;
	isActive: boolean;
	sortOrder: number;
}

export interface ScopeValues {
	light: Partial<Record<ThemeColorKey, string>>;
	dark: Partial<Record<ThemeColorKey, string>>;
	/** Block visibility: block:{blockId} → "true" | "false" */
	blocks: Record<string, string>;
	/** Layout settings */
	layout: Partial<Record<LayoutKey, string>>;
	/** Effect settings */
	effects: Partial<Record<EffectKey, string>>;
	/** Media settings */
	media: Partial<Record<MediaKey, string>>;
	/** Custom CSS/HTML */
	custom: Partial<Record<string, string>>;
}

export interface ResolvedTheme {
	palette: Record<ThemeColorKey, string>;
	darkPalette: Record<ThemeColorKey, string>;
	contributingScopes: ThemeScopeRow[];
	cssVariables: Record<string, string>;
	/** Block visibility (blockId → visible) */
	blocks: Record<string, boolean>;
	/** Resolved layout settings */
	layout: Record<LayoutKey, string>;
	/** Resolved effect settings */
	effects: Record<EffectKey, string>;
	/** Resolved media settings */
	media: Record<MediaKey, string>;
	/** Raw custom CSS from all contributing scopes */
	customCss: string;
	/** Raw custom HTML from all contributing scopes */
	customHtml: string;
}

// ─── CSS variable name mapping ───────────────────────────────────────────────

const CSS_VAR_MAP: Record<ThemeColorKey, string> = {
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

// ─── Scope loading ───────────────────────────────────────────────────────────

function rowToScopeRow(r: {
	id: bigint | number;
	name: string;
	type: string;
	parentId: bigint | number | null;
	siteDomain: string | null;
	routePath: string | null;
	moduleId: string | null;
	isActive: boolean;
	sortOrder: number;
}): ThemeScopeRow {
	return {
		id: Number(r.id),
		name: r.name,
		type: r.type as ThemeScopeType,
		parentId: r.parentId ? Number(r.parentId) : null,
		siteDomain: r.siteDomain,
		routePath: r.routePath,
		moduleId: r.moduleId,
		isActive: r.isActive,
		sortOrder: r.sortOrder,
	};
}

async function loadScopes(): Promise<ThemeScopeRow[]> {
	const rows = await db
		.select()
		.from(ThemeScope)
		.where(eq(ThemeScope.isActive, true))
		.orderBy(asc(ThemeScope.sortOrder), asc(ThemeScope.id));

	return rows.map(rowToScopeRow);
}

async function loadAllScopeValues(): Promise<Map<number, ScopeValues>> {
	const rows = await db.select().from(ThemeScopeValue);

	const result = new Map<number, ScopeValues>();

	for (const row of rows) {
		const scopeId = Number(row.scopeId);
		const key = row.settingKey;

		if (!result.has(scopeId)) {
			result.set(scopeId, {
				light: {},
				dark: {},
				blocks: {},
				layout: {},
				effects: {},
				media: {},
				custom: {},
			});
		}
		const sv = result.get(scopeId);
		if (!sv) continue;

		if (key.startsWith(BLOCK_KEY_PREFIX)) {
			sv.blocks[key] = row.settingVal;
		} else if (key.startsWith("layout:")) {
			sv.layout[key as LayoutKey] = row.settingVal;
		} else if (key.startsWith("effect:")) {
			sv.effects[key as EffectKey] = row.settingVal;
		} else if (key.startsWith("media:")) {
			sv.media[key as MediaKey] = row.settingVal;
		} else if (key.startsWith("custom:")) {
			sv.custom[key] = row.settingVal;
		} else if (row.mode === "dark") {
			sv.dark[key as ThemeColorKey] = row.settingVal;
		} else {
			sv.light[key as ThemeColorKey] = row.settingVal;
		}
	}

	return result;
}

// ─── Ancestry & scope matching ───────────────────────────────────────────────

function buildAncestry(
	scopes: ThemeScopeRow[],
	targetId: number,
): ThemeScopeRow[] {
	const byId = new Map(scopes.map((s) => [s.id, s]));
	const chain: ThemeScopeRow[] = [];
	let current = byId.get(targetId);
	while (current) {
		chain.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return chain;
}

function findBestScope(
	scopes: ThemeScopeRow[],
	context: { siteDomain?: string; routePath?: string; moduleId?: string },
): ThemeScopeRow | null {
	let best: ThemeScopeRow | null = null;

	for (const scope of scopes) {
		switch (scope.type) {
			case "global":
				if (!best) best = scope;
				break;
			case "site":
				if (context.siteDomain && scope.siteDomain === context.siteDomain) {
					best = scope;
				}
				break;
			case "module":
				if (context.moduleId && scope.moduleId === context.moduleId) {
					best = scope;
				}
				break;
			case "route":
				if (context.routePath && scope.routePath === context.routePath) {
					best = scope;
				}
				break;
		}
	}

	return best;
}

// ─── Global defaults from website_settings ───────────────────────────────────

async function getGlobalDefaults(): Promise<{
	light: Partial<Record<ThemeColorKey, string>>;
	dark: Partial<Record<ThemeColorKey, string>>;
}> {
	const keys = THEME_COLOR_KEYS.flatMap((k) => [k, `${k}_dark`]);
	const values = await siteSettings.getMany(keys);

	const light: Partial<Record<ThemeColorKey, string>> = {};
	const dark: Partial<Record<ThemeColorKey, string>> = {};

	for (const key of THEME_COLOR_KEYS) {
		const lightVal = values[key];
		const darkVal = values[`${key}_dark`];
		if (lightVal) light[key] = lightVal;
		if (darkVal) dark[key] = darkVal;
	}

	return { light, dark };
}

// ─── Main resolver ───────────────────────────────────────────────────────────

export async function resolveTheme(context: {
	siteDomain?: string;
	routePath?: string;
	moduleId?: string;
}): Promise<ResolvedTheme> {
	const allScopes = await loadScopes();
	const bestScope = findBestScope(allScopes, context);

	if (!bestScope) {
		const defaults = await getGlobalDefaults();
		return {
			palette: defaults.light as Record<ThemeColorKey, string>,
			darkPalette: defaults.dark as Record<ThemeColorKey, string>,
			contributingScopes: [],
			cssVariables: CSS_VAR_MAP,
			blocks: {},
			layout: { ...LAYOUT_DEFAULTS },
			effects: { ...EFFECT_DEFAULTS },
			media: { ...MEDIA_DEFAULTS },
			customCss: "",
			customHtml: "",
		};
	}

	const ancestry = buildAncestry(allScopes, bestScope.id);
	const allValues = await loadAllScopeValues();

	const lightPalette: Partial<Record<ThemeColorKey, string>> = {};
	const darkPalette: Partial<Record<ThemeColorKey, string>> = {};
	const blocks: Record<string, string> = {};
	const layout: Partial<Record<LayoutKey, string>> = {};
	const effects: Partial<Record<EffectKey, string>> = {};
	const media: Partial<Record<MediaKey, string>> = {};
	const customCssParts: string[] = [];
	const customHtmlParts: string[] = [];

	for (const scope of ancestry) {
		const sv = allValues.get(scope.id);
		if (!sv) continue;

		for (const key of THEME_COLOR_KEYS) {
			if (sv.light[key]) lightPalette[key] = sv.light[key];
			if (sv.dark[key]) darkPalette[key] = sv.dark[key];
		}

		// Blocks: deepest scope wins for each block
		for (const [k, v] of Object.entries(sv.blocks)) {
			blocks[k] = v;
		}

		// Layout: deepest scope wins per key
		for (const [k, v] of Object.entries(sv.layout)) {
			if (v) layout[k as LayoutKey] = v;
		}

		// Effects: deepest scope wins per key
		for (const [k, v] of Object.entries(sv.effects)) {
			if (v) effects[k as EffectKey] = v;
		}

		// Media: deepest scope wins per key
		for (const [k, v] of Object.entries(sv.media)) {
			if (v) media[k as MediaKey] = v;
		}

		// Custom: concatenate from all scopes
		const cssVal = sv.custom["custom:css"];
		if (cssVal) customCssParts.push(cssVal);
		const htmlVal = sv.custom["custom:html"];
		if (htmlVal) customHtmlParts.push(htmlVal);
	}

	const defaults = await getGlobalDefaults();
	for (const key of THEME_COLOR_KEYS) {
		if (!lightPalette[key])
			lightPalette[key] = defaults.light[key] ?? "#f59e0b";
		if (!darkPalette[key]) darkPalette[key] = defaults.dark[key] ?? "#0b0d14";
	}

	return {
		palette: lightPalette as Record<ThemeColorKey, string>,
		darkPalette: darkPalette as Record<ThemeColorKey, string>,
		contributingScopes: ancestry,
		cssVariables: CSS_VAR_MAP,
		blocks: Object.fromEntries(
			Object.entries(blocks).map(([k, v]) => [
				k.replace(BLOCK_KEY_PREFIX, ""),
				v === "true",
			]),
		),
		layout: { ...LAYOUT_DEFAULTS, ...layout },
		effects: { ...EFFECT_DEFAULTS, ...effects },
		media: { ...MEDIA_DEFAULTS, ...media },
		customCss: customCssParts.join("\n"),
		customHtml: customHtmlParts.join("\n"),
	};
}

// ─── CSS generation ──────────────────────────────────────────────────────────

export function generateScopedCss(resolved: ResolvedTheme): {
	rootCss: string;
	scopedCssBlocks: string[];
} {
	let rootCss = `:root{${THEME_COLOR_KEYS.map((k) => `--${CSS_VAR_MAP[k]}:${resolved.palette[k]};`).join("")}}html.dark{${THEME_COLOR_KEYS.map((k) => `--${CSS_VAR_MAP[k]}:${resolved.darkPalette[k]};`).join("")}}`;

	const scopedCssBlocks: string[] = [];

	// Layout CSS variables
	const layoutVars = [
		`--theme-max-width:${resolved.layout["layout:max_width"]}`,
		`--theme-spacing:${resolved.layout["layout:spacing"]}`,
		`--theme-grid-columns:${resolved.layout["layout:grid_columns"]}`,
		`--theme-content-padding:${resolved.layout["layout:content_padding"]}`,
		`--theme-navbar-height:${resolved.layout["layout:navbar_height"]}`,
	].join(";");

	// Effect CSS variables
	const effectVars = [
		`--theme-card-shadow:${resolved.effects["effect:card_shadow"]}`,
		`--theme-card-shadow-hover:${resolved.effects["effect:card_shadow_hover"]}`,
		`--theme-border-style:${resolved.effects["effect:border_style"]}`,
		`--theme-border-width:${resolved.effects["effect:border_width"]}`,
		`--theme-transition-duration:${resolved.effects["effect:transition_duration"]}`,
		`--theme-animation-scale:${resolved.effects["effect:animation_scale"]}`,
	].join(";");

	// Media CSS variables
	const mediaVars = [
		resolved.media["media:logo_url"]
			? `--theme-logo-url:url("${resolved.media["media:logo_url"].replace(/"/g, '\\"')}")`
			: "",
		resolved.media["media:background_image"]
			? `--theme-bg-image:url("${resolved.media["media:background_image"].replace(/"/g, '\\"')}")`
			: "",
		`--theme-bg-position:${resolved.media["media:background_position"]}`,
		`--theme-bg-size:${resolved.media["media:background_size"]}`,
		`--theme-bg-repeat:${resolved.media["media:background_repeat"]}`,
	]
		.filter(Boolean)
		.join(";");

	// Root: add layout + effects + media
	if (layoutVars || effectVars || mediaVars) {
		const extra = [layoutVars, effectVars, mediaVars].filter(Boolean).join(";");
		// Inject into root
		const rootEnd = rootCss.lastIndexOf("}");
		if (rootEnd !== -1) {
			rootCss = `${rootCss.slice(0, rootEnd)}${extra};${rootCss.slice(rootEnd)}`;
		}
	}

	for (const scope of resolved.contributingScopes) {
		if (scope.type === "global") continue;

		let selector: string;
		switch (scope.type) {
			case "site":
				selector = `[data-theme-site="${scope.siteDomain}"]`;
				break;
			case "module":
				selector = `[data-theme-module="${scope.moduleId}"]`;
				break;
			case "route":
				selector = `[data-theme-route="${scope.routePath}"]`;
				break;
			default:
				continue;
		}

		const vars = THEME_COLOR_KEYS.map(
			(k) => `--${CSS_VAR_MAP[k]}:${resolved.palette[k]};`,
		).join("");

		if (vars) {
			scopedCssBlocks.push(`${selector}{${vars}}`);
		}
	}

	return { rootCss, scopedCssBlocks };
}

// ─── Admin helpers ───────────────────────────────────────────────────────────

export async function getAllScopes(): Promise<ThemeScopeRow[]> {
	const rows = await db
		.select()
		.from(ThemeScope)
		.orderBy(asc(ThemeScope.sortOrder), asc(ThemeScope.id));

	return rows.map(rowToScopeRow);
}

export async function getScopeValues(
	scopeId: number,
): Promise<Record<string, { light: string; dark: string }>> {
	const rows = await db
		.select()
		.from(ThemeScopeValue)
		.where(sql`${ThemeScopeValue.scopeId} = ${scopeId}`);

	const result: Record<string, { light: string; dark: string }> = {};
	for (const row of rows) {
		if (!result[row.settingKey]) {
			result[row.settingKey] = { light: "", dark: "" };
		}
		if (row.mode === "light") {
			result[row.settingKey].light = row.settingVal;
		} else {
			result[row.settingKey].dark = row.settingVal;
		}
	}
	return result;
}

/**
 * Get all setting values for a scope (colors, blocks, layout, effects, media, custom).
 */
export async function getFullScopeValues(
	scopeId: number,
): Promise<ScopeValues> {
	const rows = await db
		.select()
		.from(ThemeScopeValue)
		.where(sql`${ThemeScopeValue.scopeId} = ${scopeId}`);

	const sv: ScopeValues = {
		light: {},
		dark: {},
		blocks: {},
		layout: {},
		effects: {},
		media: {},
		custom: {},
	};

	for (const row of rows) {
		const key = row.settingKey;
		if (key.startsWith(BLOCK_KEY_PREFIX)) {
			sv.blocks[key] = row.settingVal;
		} else if (key.startsWith("layout:")) {
			sv.layout[key as LayoutKey] = row.settingVal;
		} else if (key.startsWith("effect:")) {
			sv.effects[key as EffectKey] = row.settingVal;
		} else if (key.startsWith("media:")) {
			sv.media[key as MediaKey] = row.settingVal;
		} else if (key.startsWith("custom:")) {
			sv.custom[key] = row.settingVal;
		} else if (row.mode === "dark") {
			sv.dark[key as ThemeColorKey] = row.settingVal;
		} else {
			sv.light[key as ThemeColorKey] = row.settingVal;
		}
	}

	return sv;
}
