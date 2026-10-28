import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { verifyAndFixInteractionModesCount } from "@/lib/services/furni-import";

/**
 * POST /api/admin/import/furni/verify
 *
 * Re-runs the interaction verification over the ENTIRE items_base table,
 * correcting interaction_type, interaction_modes_count and allow_sit/
 * allow_lay/allow_walk against the real furniture data (furnidata flags +
 * .nitro animation states). Only items with authoritative data are touched —
 * no keyword guesses, so no false positives.
 */
export const POST = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const result = await verifyAndFixInteractionModesCount();
	return apiOk(result);
});
