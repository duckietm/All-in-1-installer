import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { readScanSession } from "@/lib/services/nitro-scan-session";

/**
 * Current scan session (or null when no scan ran/stored yet). Polled by the
 * Studio panel while a background scan is running so a closed-tab scan can be
 * re-attached after a refresh.
 */
export const GET = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const session = await readScanSession();
	return apiOk({ session });
});
