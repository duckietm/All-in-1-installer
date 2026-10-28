import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { publicCatalogConfig } from "@/lib/services/catalog-git-config";
import {
	catalogExportEnabled,
	catalogExportQueue,
	catalogExportStatus,
	scheduleCatalogExport,
} from "@/lib/services/catalog-git-queue";

export const GET = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	const status = await catalogExportStatus();
	if (
		status.enabled &&
		status.pending > 0 &&
		status.active === 0 &&
		!("running" in status && status.running) &&
		!("error" in status && status.error)
	)
		await scheduleCatalogExport();
	const config = publicCatalogConfig();
	return apiOk({ ...status, remote: config.remote, branch: config.branch });
});
export const POST = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	if (!catalogExportEnabled())
		return apiError("Catalog repository export is not configured", 400);
	await catalogExportQueue().request();
	await scheduleCatalogExport();
	return apiOk(await catalogExportStatus());
});
