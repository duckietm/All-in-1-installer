import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import type {
	SourceAssetCheck,
	SourceAssetItem,
} from "@/lib/furni/source-assets";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { getSource } from "@/lib/services/clone-sources";
import { inspectSourceAssets } from "@/lib/services/furniture-source-assets";
import { getOfficialHabboFurnidata } from "@/lib/services/habbo-furnidata-cache";
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const body = await request.json().catch(() => null);
		if (
			!Array.isArray(body?.items) ||
			body.items.length > 20 ||
			!validateClassnames(
				body.items.map((item: SourceAssetItem) => item?.classname),
			)
		)
			return apiError("Provide 1–20 furniture items", 400);
		if (
			body.items.some(
				(item: SourceAssetItem) =>
					!Number.isSafeInteger(item.revision) ||
					item.revision < 0 ||
					typeof item.name !== "string" ||
					item.name.length > 500,
			)
		)
			return apiError("Invalid source metadata", 400);
		const source = body.sourceId ? await getSource(body.sourceId) : null;
		if (body.sourceId && !source) return apiError("Source not found", 404);
		const entries = await getOfficialHabboFurnidata();
		const official: SourceAssetItem[] = [...entries.values()].map((entry) => ({
			id: entry.id,
			classname: entry.classname,
			name: entry.name,
			description: entry.description,
			type: entry.itemType === "i" ? "wallitem" : "flooritem",
			revision: entry.revision,
			category: entry.category,
		}));
		const results: SourceAssetCheck[] = [];
		for (let offset = 0; offset < body.items.length; offset += 4)
			results.push(
				...(await Promise.all(
					body.items
						.slice(offset, offset + 4)
						.map((item: SourceAssetItem) =>
							inspectSourceAssets(item, official, source),
						),
				)),
			);
		return apiOk({ items: results });
	},
);
