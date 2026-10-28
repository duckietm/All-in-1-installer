import { siteSettings } from "@/lib/services/site-settings";
import RadioPlayer from "./radio-player";

/**
 * Server-side guard for the radio player widget. Reads the radio_* settings on
 * the server and only mounts the client <RadioPlayer> when the radio is enabled
 * AND a stream URL is configured — so the widget's JS (and the polling it does)
 * is never shipped to the browser while the radio is off.
 *
 * Mount this once in the public layout. It is intentionally tiny: the live
 * config the player actually plays is refreshed client-side from
 * /cms_api/radio/config, which lets staff toggle the radio without a redeploy.
 */
export default async function RadioPlayerGate() {
	let enabled: boolean;
	let streamUrl: string;
	try {
		const [enabledRaw, urlRaw] = await Promise.all([
			siteSettings.get("radio_enabled", "0"),
			siteSettings.get("radio_stream_url", ""),
		]);
		const flag = (enabledRaw ?? "0").trim().toLowerCase();
		enabled = flag === "1" || flag === "true";
		streamUrl = (urlRaw ?? "").trim();
	} catch {
		// Settings unavailable — fail closed (no widget).
		return null;
	}

	if (!enabled || !streamUrl) return null;

	return <RadioPlayer />;
}
