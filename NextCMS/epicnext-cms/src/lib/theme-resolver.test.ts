// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeScopeType } from "./theme-resolver";

const state = vi.hoisted(() => ({
	scopes: [] as Record<string, unknown>[],
	values: [] as Record<string, unknown>[],
	settings: {} as Record<string, string>,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: {
		getMany: async () => state.settings,
		get: async (key: string, fallback: string | null) =>
			state.settings[key] ?? fallback,
	},
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const makeQuery = (table: unknown) => {
		const rows = () =>
			table === schema.ThemeScope ? state.scopes : state.values;
		const query: Record<string, unknown> = {};
		const self = () => query;
		query.where = self;
		query.orderBy = self;
		query.limit = self;
		// biome-ignore lint/suspicious/noThenProperty: intentional thenable for await support
		query.then = (
			resolve: (value: unknown) => unknown,
			reject: (error: unknown) => unknown,
		) => Promise.resolve(rows()).then(resolve, reject);
		query.catch = (reject: (error: unknown) => unknown) =>
			Promise.resolve(rows()).catch(reject);
		return query;
	};
	return {
		...schema,
		db: { select: () => ({ from: (table: unknown) => makeQuery(table) }) },
	};
});

import {
	EFFECT_DEFAULTS,
	LAYOUT_DEFAULTS,
	MEDIA_DEFAULTS,
} from "@/lib/theme-blocks";
import { THEME_COLOR_KEYS } from "@/lib/theme-presets";
import {
	generateScopedCss,
	getAllScopes,
	getFullScopeValues,
	getScopeValues,
	type ResolvedTheme,
	resolveTheme,
} from "./theme-resolver";

function scope(
	overrides: Partial<Record<string, unknown>> & { type?: ThemeScopeType },
) {
	return {
		id: 1,
		name: "Scope",
		type: "global" as ThemeScopeType,
		parentId: null,
		siteDomain: null,
		routePath: null,
		moduleId: null,
		isActive: true,
		sortOrder: 0,
		...overrides,
	};
}

function value(
	scopeId: number,
	settingKey: string,
	settingVal: string,
	mode = "light",
) {
	return { scopeId, settingKey, settingVal, mode };
}

beforeEach(() => {
	state.scopes = [];
	state.values = [];
	state.settings = {};
});

describe("resolveTheme", () => {
	it("falls back to global defaults when no scope matches", async () => {
		state.settings.color_primary = "#111111";
		state.settings.color_primary_dark = "#222222";
		const resolved = await resolveTheme({});
		expect(resolved.contributingScopes).toEqual([]);
		expect(resolved.palette.color_primary).toBe("#111111");
		expect(resolved.darkPalette.color_primary).toBe("#222222");
		expect(resolved.layout).toEqual(LAYOUT_DEFAULTS);
		expect(resolved.effects).toEqual(EFFECT_DEFAULTS);
		expect(resolved.media).toEqual(MEDIA_DEFAULTS);
	});

	it("merges scope values over defaults", async () => {
		state.scopes = [scope({ id: 1, type: "global" })];
		state.values = [
			value(1, "color_primary", "#abc123"),
			value(1, "color_primary", "#dark123", "dark"),
			value(1, "block:hero", "true"),
			value(1, "block:footer", "false"),
			value(1, "layout:max_width", "1200px"),
			value(1, "effect:card_shadow", "none"),
			value(1, "media:logo_url", "http://logo"),
			value(1, "custom:css", "body{}"),
			value(1, "custom:html", "<b></b>"),
		];
		const resolved = await resolveTheme({});
		expect(resolved.palette.color_primary).toBe("#abc123");
		expect(resolved.darkPalette.color_primary).toBe("#dark123");
		expect(resolved.blocks).toEqual({ hero: true, footer: false });
		expect(resolved.layout["layout:max_width"]).toBe("1200px");
		expect(resolved.effects["effect:card_shadow"]).toBe("none");
		expect(resolved.media["media:logo_url"]).toBe("http://logo");
		expect(resolved.customCss).toBe("body{}");
		expect(resolved.customHtml).toBe("<b></b>");
		// untouched keys keep their fallbacks
		expect(resolved.palette.color_text).toBe("#f59e0b");
		expect(resolved.darkPalette.color_text).toBe("#0b0d14");
	});

	it("prefers the most specific matching scope and walks ancestry", async () => {
		state.scopes = [
			scope({ id: 1, type: "global", sortOrder: 0 }),
			scope({
				id: 2,
				type: "site",
				parentId: 1,
				siteDomain: "hotel.test",
				sortOrder: 1,
			}),
			scope({
				id: 3,
				type: "route",
				parentId: 2,
				routePath: "/shop",
				sortOrder: 2,
			}),
		];
		state.values = [
			value(1, "color_primary", "#global"),
			value(2, "color_primary", "#site"),
			value(3, "color_primary", "#route"),
		];
		const resolved = await resolveTheme({
			siteDomain: "hotel.test",
			routePath: "/shop",
		});
		expect(resolved.palette.color_primary).toBe("#route");
		expect(resolved.contributingScopes.map((s) => s.id)).toEqual([1, 2, 3]);
	});

	it("matches module scopes", async () => {
		state.scopes = [scope({ id: 1, type: "module", moduleId: "catalog" })];
		state.values = [value(1, "color_primary", "#module")];
		const resolved = await resolveTheme({ moduleId: "catalog" });
		expect(resolved.palette.color_primary).toBe("#module");
	});
});

describe("generateScopedCss", () => {
	function resolvedTheme(
		overrides: Partial<ResolvedTheme> = {},
	): ResolvedTheme {
		const palette = Object.fromEntries(
			THEME_COLOR_KEYS.map((key) => [key, "#111111"]),
		) as ResolvedTheme["palette"];
		const darkPalette = Object.fromEntries(
			THEME_COLOR_KEYS.map((key) => [key, "#222222"]),
		) as ResolvedTheme["darkPalette"];
		return {
			palette,
			darkPalette,
			contributingScopes: [],
			cssVariables: {},
			blocks: {},
			layout: { ...LAYOUT_DEFAULTS },
			effects: { ...EFFECT_DEFAULTS },
			media: { ...MEDIA_DEFAULTS },
			customCss: "",
			customHtml: "",
			...overrides,
		};
	}

	it("emits root variables plus layout, effect and media vars", () => {
		const { rootCss } = generateScopedCss(resolvedTheme());
		expect(rootCss).toContain(":root{--color-primary:#111111;");
		expect(rootCss).toContain("html.dark{--color-primary:#222222;");
		expect(rootCss).toContain("--theme-max-width:");
		expect(rootCss).toContain("--theme-card-shadow:");
	});

	it("emits scoped selectors and escapes media urls", () => {
		const { rootCss, scopedCssBlocks } = generateScopedCss(
			resolvedTheme({
				contributingScopes: [
					scope({ id: 1, type: "global" }),
					scope({ id: 2, type: "site", siteDomain: "hotel.test" }),
					scope({ id: 3, type: "module", moduleId: "shop" }),
					scope({ id: 4, type: "route", routePath: "/shop" }),
				],
				media: {
					...MEDIA_DEFAULTS,
					"media:logo_url": 'http://logo/"quoted"',
				},
			}),
		);
		expect(rootCss).toContain(
			'--theme-logo-url:url("http://logo/\\"quoted\\"")',
		);
		expect(scopedCssBlocks).toHaveLength(3);
		expect(scopedCssBlocks[0]).toMatch(/^\[data-theme-site="hotel\.test"\]\{/);
		expect(scopedCssBlocks[0]).toContain("--color-primary:#111111;");
		expect(scopedCssBlocks[0]).toContain("--gradient-to:#111111;");
		expect(scopedCssBlocks[1]).toContain('[data-theme-module="shop"]');
		expect(scopedCssBlocks[2]).toContain('[data-theme-route="/shop"]');
	});
});

describe("admin helpers", () => {
	it("getAllScopes normalises bigint ids", async () => {
		state.scopes = [scope({ id: 7n, parentId: 3n, type: "site" })];
		const rows = await getAllScopes();
		expect(rows[0]?.id).toBe(7);
		expect(rows[0]?.parentId).toBe(3);
	});

	it("getScopeValues splits light and dark", async () => {
		state.values = [
			value(1, "color_primary", "#light"),
			value(1, "color_primary", "#dark", "dark"),
		];
		expect(await getScopeValues(1)).toEqual({
			color_primary: { light: "#light", dark: "#dark" },
		});
	});

	it("getFullScopeValues buckets every key family", async () => {
		state.values = [
			value(1, "color_primary", "#light"),
			value(1, "color_primary", "#dark", "dark"),
			value(1, "block:hero", "true"),
			value(1, "layout:max_width", "1000px"),
			value(1, "effect:card_shadow", "sm"),
			value(1, "media:logo_url", "http://x"),
			value(1, "custom:css", "a{}"),
		];
		const full = await getFullScopeValues(1);
		expect(full.light.color_primary).toBe("#light");
		expect(full.dark.color_primary).toBe("#dark");
		expect(full.blocks["block:hero"]).toBe("true");
		expect(full.layout["layout:max_width"]).toBe("1000px");
		expect(full.effects["effect:card_shadow"]).toBe("sm");
		expect(full.media["media:logo_url"]).toBe("http://x");
		expect(full.custom["custom:css"]).toBe("a{}");
	});
});
