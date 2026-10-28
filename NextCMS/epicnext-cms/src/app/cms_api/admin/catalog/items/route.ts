import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { loadCatalogItemsData } from "@/lib/services/catalog-items-loader";

export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const pageId = Number(request.nextUrl.searchParams.get("pageId"));
		if (!Number.isFinite(pageId) || pageId <= 0) {
			return apiError("Invalid pageId");
		}
		const catalog =
			request.nextUrl.searchParams.get("catalog") === "bc" ? "bc" : "normal";
		// Both catalogs go through the loader. The BC branch used to select the
		// rows directly, which returned them without the furni enrichment the
		// table needs to render anything but a bare caption.
		return apiOk(
			(await loadCatalogItemsData(pageId, catalog)) as unknown as Record<
				string,
				unknown
			>,
		);
	},
);
