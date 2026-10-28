import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { inspectFurniture } from "@/lib/services/furniture-inspection";
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const body = await request.json().catch(() => null),
			names = validateClassnames(body?.classnames);
		if (!names)
			return apiError("Provide 1–500 valid furniture classnames", 400);
		return apiOk({ items: await inspectFurniture(names) });
	},
);
