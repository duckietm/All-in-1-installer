import { apiJson } from "@/lib/api";
import { THEME_COLOR_KEYS } from "@/lib/theme-presets";
import { generateScopedCss, resolveTheme } from "@/lib/theme-resolver";

// GET /api/themes/export?module=shop&route=/login
// Exports the resolved theme as CSS variables and metadata.
// Useful for external integrations, iframes, and embed widgets.

export async function GET(req: Request) {
	try {
		const url = new URL(req.url);
		const module = url.searchParams.get("module") ?? undefined;
		const route = url.searchParams.get("route") ?? undefined;
		const site = url.searchParams.get("site") ?? undefined;
		const format = url.searchParams.get("format") ?? "json";

		const resolved = await resolveTheme({
			siteDomain: site ?? undefined,
			routePath: route ?? undefined,
			moduleId: module ?? undefined,
		});

		if (format === "css") {
			const { rootCss, scopedCssBlocks } = generateScopedCss(resolved);
			const fullCss = [rootCss, ...scopedCssBlocks].join("\n");
			return new Response(fullCss, {
				headers: {
					"Content-Type": "text/css",
					"Cache-Control": "public, max-age=300",
				},
			});
		}

		if (format === "variables") {
			const variables: Record<string, string> = {};
			for (const key of THEME_COLOR_KEYS) {
				variables[`--${resolved.cssVariables[key]}`] = resolved.palette[key];
			}
			return apiJson({
				light: variables,
				dark: Object.fromEntries(
					THEME_COLOR_KEYS.map((key) => [
						`--${resolved.cssVariables[key]}`,
						resolved.darkPalette[key],
					]),
				),
				scopes: resolved.contributingScopes.map((s) => ({
					id: s.id,
					name: s.name,
					type: s.type,
				})),
			});
		}

		// Default: full JSON export
		const lightVariables: Record<string, string> = {};
		const darkVariables: Record<string, string> = {};
		for (const key of THEME_COLOR_KEYS) {
			lightVariables[`--${resolved.cssVariables[key]}`] = resolved.palette[key];
			darkVariables[`--${resolved.cssVariables[key]}`] =
				resolved.darkPalette[key];
		}

		return apiJson({
			palette: {
				light: resolved.palette,
				dark: resolved.darkPalette,
			},
			cssVariables: {
				light: lightVariables,
				dark: darkVariables,
			},
			scopes: resolved.contributingScopes.map((s) => ({
				id: s.id,
				name: s.name,
				type: s.type,
			})),
			meta: {
				generatedAt: new Date().toISOString(),
				format: "atom-theme-v1",
			},
		});
	} catch {
		return apiJson({ error: "Failed to resolve theme" }, { status: 500 });
	}
}
