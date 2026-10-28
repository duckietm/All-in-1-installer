import {
	readCatalogHotelHistory,
	readCatalogHotelStatus,
	sendCatalogUpdate,
} from "@/features/catalog/server/sync-status";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { catalogExportStatus } from "@/lib/services/catalog-git-queue";
export const GET = withAdmin({ permission: PERMS.CATALOG_VIEW }, async () => {
	const [hotel, history, git] = await Promise.all([
		readCatalogHotelStatus(),
		readCatalogHotelHistory(),
		catalogExportStatus(),
	]);
	return apiOk({ hotel, history, git });
});
export const POST = withAdmin({ permission: PERMS.CATALOG_EDIT }, async () =>
	apiOk({ hotel: await sendCatalogUpdate() }),
);
