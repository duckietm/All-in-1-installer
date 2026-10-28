import type { MetadataRoute } from "next";
import { resolveHotelName } from "@/lib/hotel-name";
import { siteSettings } from "@/lib/services/site-settings";

// Installation metadata must be resolved from the running container.
export const dynamic = "force-dynamic";

// Web app manifest — makes the hotel installable as a PWA (AtomCMS exposed PWA
// settings but the rewrite ships a real, themeable manifest). Name + theme
// colour follow the live website_settings; falls back to defaults with no DB.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
	const name = await resolveHotelName();
	const theme =
		(await siteSettings.get("color_primary", "#f59e0b")) ?? "#f59e0b";

	return {
		name,
		short_name: name,
		description: `${name} — a Habbo retro hotel.`,
		start_url: "/",
		display: "standalone",
		background_color: "#0f1117",
		theme_color: theme,
		icons: [
			{
				src: "/assets/images/home_icon.gif",
				sizes: "any",
				type: "image/gif",
				purpose: "any",
			},
		],
	};
}
