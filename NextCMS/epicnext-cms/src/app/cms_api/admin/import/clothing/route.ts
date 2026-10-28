import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	deleteImportedFigure,
	getFigureList,
	getFigureStats,
} from "@/lib/services/figure-import";

export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		if (request.nextUrl.searchParams.get("action") === "stats")
			return apiOk(await getFigureStats());
		const search = request.nextUrl.searchParams.get("search") || "";
		const page = Number.parseInt(
			request.nextUrl.searchParams.get("page") || "1",
			10,
		);
		const { items, meta } = await getFigureList({
			search,
			page: page || 1,
			perPage: 100,
		});
		return apiOk({ items, meta });
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const lib = request.nextUrl.searchParams.get("lib");
		if (!lib) return apiError("Missing lib", 400);
		const { deletedFile } = await deleteImportedFigure(lib);
		if (!deletedFile) return apiError(`Library "${lib}" not found`, 404);
		logAudit({
			userId: ctx.session.user.id,
			action: "figure_delete",
			target: "FigureAsset",
			targetId: 0,
			after: { lib },
		});
		return apiOk({ lib, deletedFile });
	},
);
