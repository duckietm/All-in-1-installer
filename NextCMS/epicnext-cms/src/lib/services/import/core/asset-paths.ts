import { existsSync } from "node:fs";
import path from "node:path";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import { getRuntimePath } from "@/lib/utils/runtime-path";

// The CMS default gamedata JSON paths point under public/nitro-assets/gamedata/,
// but this deployment keeps the gamedata JSON (FigureMap/FigureData/EffectMap…)
// under the gamedata root (public/Gamedata/config/ or the deployment's
// `/var/www/gamedata/config/`). `resolveGamedataFile` falls back there when the
// configured path is absent, so importers read AND write the real file — no
// manual setting required. (Bundled .nitro stay under the gamedata root's
// `bundled/` dir, the location the Nitro client loads from.)

function pub(...segs: string[]): string {
	return getRuntimePath(
		/*turbopackIgnore: true*/ process.cwd(),
		"public",
		...segs,
	);
}

/**
 * Resolve a gamedata JSON file from a `*_url` setting value (e.g.
 * `/nitro-assets/gamedata/FigureMap.json`). Falls back to the deployment's
 * gamedata root `config/` dir (then `public/Gamedata/config/`) when the
 * configured path is absent. Returns the configured path when neither exists
 * (write target for fresh setups).
 */
export async function resolveGamedataFile(
	url: string,
	fallbackName: string,
): Promise<string> {
	// A Windows drive/UNC path (e.g. configured on a Windows dev machine) is
	// used as-is. Note: path.win32.isAbsolute('/foo') is true on Linux, so we
	// match the drive/UNC prefix explicitly instead of delegating to it —
	// otherwise web paths like `/nitro-assets/gamedata/FigureMap.json` would be
	// mistaken for absolute filesystem paths and returned verbatim.
	if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("\\\\")) return url;
	// A real, existing absolute filesystem path is used as-is.
	if (path.isAbsolute(url) && existsSync(/*turbopackIgnore: true*/ url)) {
		return url;
	}
	const configured = pub(url.replace(/^\/+/, ""));
	if (existsSync(/*turbopackIgnore: true*/ configured)) return configured;

	// Deployment gamedata root (e.g. /var/www/gamedata/config/…).
	const gamedataRoot = await getGamedataRoot();
	if (gamedataRoot) {
		const rootConfig = getRuntimePath(
			/*turbopackIgnore: true*/ gamedataRoot,
			"config",
			fallbackName,
		);
		if (existsSync(/*turbopackIgnore: true*/ rootConfig)) return rootConfig;
	}

	const gamedata = pub("Gamedata", "config", fallbackName);
	if (existsSync(/*turbopackIgnore: true*/ gamedata)) return gamedata;
	return configured;
}
