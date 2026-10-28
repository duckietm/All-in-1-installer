import { asc, eq } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { db, ThemeScope, ThemeScopeValue } from "@/lib/db";
import {
	BLOCK_KEY_PREFIX,
	type EffectKey,
	type LayoutKey,
	type MediaKey,
	THEME_BLOCKS,
} from "@/lib/theme-blocks";
import { THEME_COLOR_KEYS, type ThemeColorKey } from "@/lib/theme-presets";
import { SCOPED_THEMES_CACHE_KEY } from "@/lib/theme-scope-cache";

// ─── Scoped CSS injection ────────────────────────────────────────────────────
// Injects CSS blocks for module/route overrides using data-attribute selectors.
// Also handles block visibility, layout, effects, media, and custom CSS.

type ThemeScopeType = "global" | "site" | "module" | "route";

interface ScopeRow {
	id: number;
	type: ThemeScopeType;
	siteDomain: string | null;
	routePath: string | null;
	moduleId: string | null;
}

interface ScopeValues {
	light: Partial<Record<ThemeColorKey, string>>;
	dark: Partial<Record<ThemeColorKey, string>>;
	blocks: Record<string, string>;
	layout: Partial<Record<LayoutKey, string>>;
	effects: Partial<Record<EffectKey, string>>;
	media: Partial<Record<MediaKey, string>>;
	custom: Partial<Record<string, string>>;
}

/**
 * Rendered by the root layout on every page: cached for a minute (theme-builder saves clear it)
 * instead of one or two queries per page view.
 */
function loadScopedThemes(): Promise<
	Array<{ scope: ScopeRow; values: ScopeValues }>
> {
	return cached(SCOPED_THEMES_CACHE_KEY, 60_000, loadScopedThemesFromDb, {
		staleMs: 300_000,
	});
}

async function loadScopedThemesFromDb(): Promise<
	Array<{ scope: ScopeRow; values: ScopeValues }>
> {
	const rows = await db
		.select()
		.from(ThemeScope)
		.where(eq(ThemeScope.isActive, true))
		.orderBy(asc(ThemeScope.sortOrder), asc(ThemeScope.id));

	const scopes: ScopeRow[] = rows
		.filter((r) => r.type !== "global")
		.map((r) => ({
			id: Number(r.id),
			type: r.type as ThemeScopeType,
			siteDomain: r.siteDomain,
			routePath: r.routePath,
			moduleId: r.moduleId,
		}));

	if (scopes.length === 0) return [];

	const allValues = await db.select().from(ThemeScopeValue);

	const valuesByScope = new Map<number, ScopeValues>();
	for (const row of allValues) {
		const scopeId = Number(row.scopeId);
		const key = row.settingKey;
		if (!valuesByScope.has(scopeId)) {
			valuesByScope.set(scopeId, {
				light: {},
				dark: {},
				blocks: {},
				layout: {},
				effects: {},
				media: {},
				custom: {},
			});
		}
		const sv = valuesByScope.get(scopeId);
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
		} else if (row.mode === "light") {
			sv.light[key as ThemeColorKey] = row.settingVal;
		} else {
			sv.dark[key as ThemeColorKey] = row.settingVal;
		}
	}

	return scopes
		.filter((s) => valuesByScope.has(s.id))
		.map((scope) => ({
			scope,
			values: valuesByScope.get(scope.id) ?? {
				light: {},
				dark: {},
				blocks: {},
				layout: {},
				effects: {},
				media: {},
				custom: {},
			},
		}));
}

function escapeAttr(v: string): string {
	return v.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeCss(v: string): string {
	return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildScopedCssBlock(
	scope: ScopeRow,
	values: ScopeValues,
): string | null {
	let selector: string;
	switch (scope.type) {
		case "site":
			if (!scope.siteDomain) return null;
			selector = `[data-theme-site="${escapeAttr(scope.siteDomain)}"]`;
			break;
		case "module":
			if (!scope.moduleId) return null;
			selector = `[data-theme-module="${escapeAttr(scope.moduleId)}"]`;
			break;
		case "route":
			if (!scope.routePath) return null;
			selector = `[data-theme-route="${escapeAttr(scope.routePath)}"]`;
			break;
		default:
			return null;
	}

	const parts: string[] = [];

	// Color variables
	const lightVars = THEME_COLOR_KEYS.filter((k) => values.light[k])
		.map((k) => `--${k}:${values.light[k]};`)
		.join("");
	const darkVars = THEME_COLOR_KEYS.filter((k) => values.dark[k])
		.map((k) => `--${k}:${values.dark[k]};`)
		.join("");

	if (lightVars) parts.push(`${selector}{${lightVars}}`);
	if (darkVars) parts.push(`html.dark ${selector}{${darkVars}}`);

	// Block visibility — hide blocks with display:none
	const hiddenBlocks = Object.entries(values.blocks)
		.filter(([, v]) => v === "false")
		.map(([k]) => k.replace(BLOCK_KEY_PREFIX, ""));

	if (hiddenBlocks.length > 0) {
		const blockSelectors = hiddenBlocks
			.map((blockId) => {
				const block = THEME_BLOCKS.find((b) => b.id === blockId);
				return block ? block.selector : `[data-theme-block="${blockId}"]`;
			})
			.join(",");
		// Apply within scope selector context
		if (blockSelectors) {
			parts.push(`${selector} ${blockSelectors}{display:none !important;}`);
		}
	}

	// Layout CSS variables
	const layoutVars = Object.entries(values.layout)
		.filter(([, v]) => v)
		.map(([k, v]) => {
			const cssKey = k.replace("layout:", "theme-");
			return `--${cssKey}:${v};`;
		})
		.join("");
	if (layoutVars) {
		parts.push(`${selector}{${layoutVars}}`);
	}

	// Effect CSS variables
	const effectVars = Object.entries(values.effects)
		.filter(([, v]) => v)
		.map(([k, v]) => {
			const cssKey = k.replace("effect:", "theme-");
			const val = v ?? "";
			return `--${cssKey}:${escapeCss(val)};`;
		})
		.join("");
	if (effectVars) {
		parts.push(`${selector}{${effectVars}}`);
	}

	// Media CSS variables
	const mediaVars = Object.entries(values.media)
		.filter(([, v]) => v)
		.map(([k, v]) => {
			const cssKey = k.replace("media:", "theme-");
			const val = v ?? "";
			if (k === "media:logo_url") {
				return `--theme-logo-url:url("${escapeCss(val)}");`;
			}
			if (k === "media:background_image") {
				return `--theme-bg-image:url("${escapeCss(val)}");`;
			}
			return `--${cssKey}:${val};`;
		})
		.join("");
	if (mediaVars) {
		parts.push(`${selector}{${mediaVars}}`);
	}

	// Custom CSS
	const customCss = values.custom["custom:css"];
	if (customCss) {
		// Replace & with the scope selector for user convenience
		const processed = customCss.replace(/&/g, selector);
		parts.push(processed);
	}

	if (parts.length === 0) return null;
	// Staff-authored text goes into a <style> element: "<" (as in "</style>") would end it and
	// put HTML into every page. In CSS, "\3C " is the same character.
	return parts.join("").replace(/</g, "\\3C ");
}

/**
 * ScopedThemeVars injects CSS blocks for non-global theme scopes.
 * Place this after <ThemeVars> in your layout.
 */
export async function ScopedThemeVars({ nonce }: { nonce?: string }) {
	const scoped = await loadScopedThemes();
	if (scoped.length === 0) return null;

	const blocks: string[] = [];
	for (const { scope, values } of scoped) {
		const css = buildScopedCssBlock(scope, values);
		if (css) blocks.push(css);
	}

	if (blocks.length === 0) return null;

	return (
		<style
			nonce={nonce}
			dangerouslySetInnerHTML={{ __html: blocks.join("") }}
		/>
	);
}
