import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { planGamedataCleanup } from "@/lib/furni/gamedata-dedupe";
import { PERMS } from "@/lib/permissions";

/**
 * Read-only preview of the gamedata cleanup: duplicate FurnitureData rows,
 * FurnitureData rows whose `.nitro` is gone, and the dangling/duplicated
 * FigureMap parts plus the FigureData entries nothing points at any more.
 *
 * Nothing here writes. The apply endpoint re-derives every decision under its
 * own lock, so this response is a report for the operator rather than a plan
 * that is replayed later.
 */
export const GET = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	try {
		return apiOk({ plan: await planGamedataCleanup() });
	} catch (err) {
		return apiError(
			`Gamedata cleanup preview failed: ${(err as Error).message}`,
			500,
		);
	}
});
