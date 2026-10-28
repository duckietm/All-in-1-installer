import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { cancelScanSession } from "@/lib/services/nitro-scan-session";

/**
 * Abort the running background scan (in-process, or by marking the session
 * cancelled when the process that owns it is not the one serving the request).
 */
export const POST = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const session = await cancelScanSession();
	return apiOk({ session });
});
