import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

// Radio player config: the subset of radio_* website_settings the front-end
// player needs (stream URL, name, autoplay, enabled, widget visibility) as a
// flat { key: value } map. No secrets live among these keys.

const CONFIG_KEYS = [
	"radio_enabled",
	"radio_name",
	"radio_stream_url",
	"radio_stream_backup_url",
	"radio_auto_play",
	"radio_auto_play_delay",
	"radio_mute_on_start",
	"radio_volume",
	"radio_style",
	"radio_player_type",
	"radio_logo_url",
	"radio_widget_enabled",
	"radio_widget_show_globally",
	"radio_widget_position",
];

export async function GET(_req: Request) {
	try {
		const values = await siteSettings.getMany(CONFIG_KEYS);
		const config: Record<string, string> = {};
		for (const [key, val] of Object.entries(values)) {
			if (val !== null) config[key] = val;
		}
		return apiJson(config);
	} catch {
		return apiJson({}, { status: 200 });
	}
}
