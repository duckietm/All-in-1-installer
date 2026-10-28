// Public REST: whether the radio player should auto-play on load. Reads the
// radio_auto_play website setting (the key the admin radio settings page
// writes), falling back to the legacy radio_autoplay alias if present. Booleans
// are stored as the strings '1' / '0'. Returns { autoplay: boolean }.
import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

function truthy(value: string | null | undefined): boolean {
	if (value === undefined || value === null) return false;
	const s = value.trim().toLowerCase();
	return s === "1" || s === "true";
}

export async function GET(_req: Request) {
	try {
		const values = await siteSettings.getMany([
			"radio_auto_play",
			"radio_autoplay",
		]);
		const autoplay = truthy(values.radio_auto_play ?? values.radio_autoplay);
		return apiJson({ autoplay });
	} catch {
		return apiJson({ autoplay: false }, { status: 200 });
	}
}
