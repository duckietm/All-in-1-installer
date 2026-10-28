import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";
import { batchLookupByClassnames } from "@/lib/services/habbofurni";

export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const hotel = await getHabboGamedataHotel();
		const raw = request.nextUrl.searchParams.get("classnames") || "";
		const classnames = raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 100);

		if (classnames.length === 0) {
			return apiOk({ hotel, suggestions: {} });
		}

		const found = await batchLookupByClassnames(classnames);
		const suggestions: Record<string, { name: string; description: string }> =
			{};

		for (const [classname, entry] of found) {
			suggestions[classname] = {
				name: entry.name ?? "",
				description: entry.description ?? "",
			};
		}

		return apiOk({ hotel, suggestions });
	},
);
