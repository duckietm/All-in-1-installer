import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import {
	getClothingSetList,
	getClothingSetStats,
} from "@/lib/services/clothing-set-import";

export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		if (request.nextUrl.searchParams.get("action") === "stats") {
			return apiOk(
				(await getClothingSetStats()) as unknown as Record<string, unknown>,
			);
		}
		const search = request.nextUrl.searchParams.get("search") || "";
		const page = Number.parseInt(
			request.nextUrl.searchParams.get("page") || "1",
			10,
		);
		const setType = request.nextUrl.searchParams.get("setType") || undefined;
		const { items, meta } = await getClothingSetList({
			search,
			page: page || 1,
			perPage: 100,
			setType,
		});
		return apiOk({ items, meta });
	},
);
