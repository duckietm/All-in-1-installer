import { promises as fs } from "node:fs";
import path from "node:path";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";

function externalTextsPath(gamedataRoot: string): string {
	return path.join(gamedataRoot, "config", "ExternalTexts.json");
}

/** GET - Read badge name/desc from ExternalTexts.json */
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const code = request.nextUrl.searchParams.get("code")?.toUpperCase();
		if (!code) return apiError("Missing code", 400);

		const gamedataRoot = await getGamedataRoot();
		if (!gamedataRoot) return apiError("gamedata_root not configured", 500);

		try {
			const raw = await fs.readFile(externalTextsPath(gamedataRoot), "utf-8");
			const texts: Record<string, string> = JSON.parse(raw);

			const name =
				texts[`badge_name_${code}`] ?? texts[`${code}_badge_name`] ?? "";
			const desc =
				texts[`badge_desc_${code}`] ?? texts[`${code}_badge_desc`] ?? "";

			return apiOk({ name, desc });
		} catch {
			return apiError("Failed to read ExternalTexts.json", 500);
		}
	},
);
