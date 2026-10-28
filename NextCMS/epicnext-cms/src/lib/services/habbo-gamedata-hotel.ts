import "server-only";

import {
	DEFAULT_HABBO_GAMEDATA_HOTEL,
	HABBO_GAMEDATA_HOTEL_SETTING_KEY,
	type HabboGamedataHotel,
	normalizeHabboGamedataHotel,
} from "@/lib/habbo-gamedata-hotel";
import { siteSettings } from "@/lib/services/site-settings";

/** Read configured Habbo hotel TLD from CMS settings (server-only). */
export async function getHabboGamedataHotel(): Promise<HabboGamedataHotel> {
	const raw = await siteSettings.get(
		HABBO_GAMEDATA_HOTEL_SETTING_KEY,
		DEFAULT_HABBO_GAMEDATA_HOTEL,
	);
	return normalizeHabboGamedataHotel(raw);
}
