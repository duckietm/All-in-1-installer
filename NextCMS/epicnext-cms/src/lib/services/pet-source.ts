import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * The canonical Habbo pet set (matches renderer-config.json `pet.types`).
 * The lib/filename for each is the name itself → `{name}.nitro`.
 */
export const CANONICAL_PETS: string[] = [
	"dog",
	"cat",
	"croco",
	"terrier",
	"bear",
	"pig",
	"lion",
	"rhino",
	"spider",
	"turtle",
	"chicken",
	"frog",
	"dragon",
	"monster",
	"monkey",
	"horse",
	"monsterplant",
	"bunnyeaster",
	"bunnyevil",
	"bunnydepressed",
	"bunnylove",
	"pigeongood",
	"pigeonevil",
	"demonmonkey",
	"bearbaby",
	"terrierbaby",
	"gnome",
	"kittenbaby",
	"puppybaby",
	"pigletbaby",
	"haloompa",
	"fools",
	"pterosaur",
	"velociraptor",
	"cow",
	"elephants",
];

export async function resolvePetSwfUrl(lib: string): Promise<string> {
	const override = (
		(await siteSettings.get("pet_swf_base_url", "")) ?? ""
	).trim();
	if (override) return `${override.replace(/\/+$/, "")}/${lib}.swf`;
	const gordon = await resolveGordonBuildUrl();
	return `${gordon}${lib}.swf`;
}
