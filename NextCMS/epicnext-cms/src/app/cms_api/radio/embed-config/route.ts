import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

// Minimal radio_* settings an external page needs to embed the player: stream
// URL, display name, whether the radio is enabled, and autoplay. Returned as a
// flat { key: value } map. None of these keys are secrets.

const EMBED_KEYS = [
	"radio_enabled",
	"radio_name",
	"radio_stream_url",
	"radio_auto_play",
];

export async function GET(_req: Request) {
	try {
		const values = await siteSettings.getMany(EMBED_KEYS);
		const config: Record<string, string> = {};
		for (const [key, val] of Object.entries(values)) {
			if (val !== null) config[key] = val;
		}
		return apiJson(config);
	} catch {
		return apiJson({}, { status: 200 });
	}
}
