import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import {
	deleteImportedPet,
	getPetList,
	getPetStats,
} from "@/lib/services/pet-import";

export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		if (request.nextUrl.searchParams.get("action") === "stats")
			return apiOk(await getPetStats());
		const search = request.nextUrl.searchParams.get("search") || "";
		return apiOk({ pets: getPetList(search) });
	},
);

export const DELETE = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		const lib = request.nextUrl.searchParams.get("lib");
		if (!lib) return apiError("Missing lib", 400);
		const { deletedFile } = await deleteImportedPet(lib);
		if (!deletedFile) return apiError(`Pet "${lib}" not found`, 404);
		logAudit({
			userId: ctx.session.user.id,
			action: "pet_delete",
			target: "PetAsset",
			targetId: 0,
			after: { lib },
		});
		return apiOk({ lib, deletedFile });
	},
);
