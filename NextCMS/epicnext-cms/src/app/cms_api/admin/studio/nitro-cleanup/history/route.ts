import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { readAutoCleanHistory } from "@/lib/services/nitro-cleanup";

/** Auto-clean history (manual + nightly scheduled runs), newest first. */
export const GET = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const history = await readAutoCleanHistory();
	return apiOk({ history });
});
