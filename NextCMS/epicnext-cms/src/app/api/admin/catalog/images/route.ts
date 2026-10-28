import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import {
	catalogueAssetDirectories,
	readCatalogueAssetFiles,
} from "@/lib/services/catalog-assets";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";

export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const sp = request.nextUrl.searchParams;
		const limit = Math.min(
			Math.max(Number(sp.get("limit") || 80) || 80, 1),
			500,
		);
		const offset = Math.max(Number(sp.get("offset") || 0) || 0, 0);
		const search = (sp.get("search") || "").trim().toLowerCase();
		const type = sp.get("type") || "all";

		let names: string[] = [];
		const directories = catalogueAssetDirectories(await getGamedataRoot());
		const files = await readCatalogueAssetFiles(directories);
		const seen = new Set<string>();
		for (const file of files) {
			if (/^icon_\d+\./i.test(file)) continue;
			const base = file.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
			if (!base || seen.has(base)) continue;
			seen.add(base);
			names.push(base);
		}
		names.sort((a, b) => a.localeCompare(b));

		if (type === "header") {
			names = names.filter((n) => /header/i.test(n));
		} else if (type === "teaser") {
			names = names.filter((n) => /teaser/i.test(n));
		}

		if (search) {
			names = names.filter((n) => n.toLowerCase().includes(search));
		}

		const total = names.length;
		const images = names.slice(offset, offset + limit);
		return apiOk({ images, total });
	},
);
