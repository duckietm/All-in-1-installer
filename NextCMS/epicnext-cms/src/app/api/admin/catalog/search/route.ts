import { catalogFailure } from "@/features/catalog/server/errors";
import { searchCatalog } from "@/features/catalog/server/search";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const params = request.nextUrl.searchParams;
		try {
			return apiOk({
				results: await searchCatalog(
					params.get("catalog") ?? "normal",
					params.get("q") ?? "",
				),
			});
		} catch (error) {
			const failure = catalogFailure(error);
			return apiError(failure.message, failure.status);
		}
	},
);
