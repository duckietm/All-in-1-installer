import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";

export async function resolveFigureSwfUrl(lib: string): Promise<string> {
	const override = (
		(await siteSettings.get("figure_swf_base_url", "")) ?? ""
	).trim();
	if (override) return `${override.replace(/\/+$/, "")}/${lib}.swf`;
	const gordon = await resolveGordonBuildUrl();
	return `${gordon}${lib}.swf`;
}
