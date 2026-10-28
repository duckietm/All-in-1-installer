import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	deleteImportedEffect,
	getEffectList,
	getEffectStats,
} from "@/lib/services/effect-import";

export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const action = request.nextUrl.searchParams.get("action");
		if (action === "stats") {
			return apiOk(await getEffectStats());
		}
		const search = request.nextUrl.searchParams.get("search") || "";
		const effects = await getEffectList(search);
		return apiOk({ effects });
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const idOrLib =
			request.nextUrl.searchParams.get("lib") ||
			request.nextUrl.searchParams.get("id");
		if (!idOrLib) return apiError("Missing lib/id", 400);
		const { removed, deletedFile } = await deleteImportedEffect(idOrLib);
		if (!removed && !deletedFile)
			return apiError(`Effect "${idOrLib}" not found`, 404);
		logAudit({
			userId: ctx.session.user.id,
			action: "effect_delete",
			target: "EffectMap",
			targetId: 0,
			after: { idOrLib, removed, deletedFile },
		});
		return apiOk({ idOrLib, removed, deletedFile });
	},
);
