import { siteSettings } from "@/lib/services/site-settings";

/**
 * Minimum hotel rank treated as staff (admin lists + public staff page).
 * Setting: `min_staff_rank` (default 7).
 */
export async function getMinStaffRank(fallback = 7): Promise<number> {
	const raw = await siteSettings.get("min_staff_rank", String(fallback));
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
