import { THEME_COLOR_KEYS } from "@/lib/theme-presets";
import { resolveTheme } from "@/lib/theme-resolver";

// GET /cms_api/themes/export/embed.js?module=shop
// Returns a self-contained JavaScript snippet that injects theme CSS variables.

export async function GET(req: Request) {
	try {
		const url = new URL(req.url);
		const moduleParam = url.searchParams.get("module") ?? undefined;
		const route = url.searchParams.get("route") ?? undefined;
		const site = url.searchParams.get("site") ?? undefined;

		const resolved = await resolveTheme({
			siteDomain: site ?? undefined,
			routePath: route ?? undefined,
			moduleId: moduleParam ?? undefined,
		});

		const lightVars = THEME_COLOR_KEYS.map(
			(key) => `  --${resolved.cssVariables[key]}: ${resolved.palette[key]};`,
		).join("\n");
		const darkVars = THEME_COLOR_KEYS.map(
			(key) =>
				`  --${resolved.cssVariables[key]}: ${resolved.darkPalette[key]};`,
		).join("\n");

		const js = `(function(){
  var s=document.createElement('style');
  s.textContent=':root{\\n${lightVars.replace(/'/g, "\\'")}\\n}html.dark{\\n${darkVars.replace(/'/g, "\\'")}\\n}';
  document.head.appendChild(s);
})();`;

		return new Response(js, {
			headers: {
				"Content-Type": "application/javascript",
				"Cache-Control": "public, max-age=300",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch {
		return new Response("/* theme embed failed */", {
			headers: { "Content-Type": "application/javascript" },
		});
	}
}
