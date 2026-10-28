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
			Math.max(Number(sp.get("limit") || 120) || 120, 1),
			500,
		);
		const offset = Math.max(Number(sp.get("offset") || 0) || 0, 0);
		const search = (sp.get("search") || "").trim().toLowerCase();

		const directories = catalogueAssetDirectories(await getGamedataRoot());
		const files = await readCatalogueAssetFiles(directories);
		// A handful of icons ship as both `.png` and `.gif`. The client always
		// tries `.png` first and falls back to `.gif`, so an id that has both is
		// one icon, not two — dedupe instead of offering it twice in the picker.
		let icons = [
			...new Set(
				files
					.map((f) => /^icon_(\d+)\.(?:png|gif)$/i.exec(f))
					.filter((m): m is RegExpExecArray => Boolean(m))
					.map((m) => Number(m[1]))
					.filter((n) => Number.isFinite(n)),
			),
		].sort((a, b) => a - b);

		if (search) {
			icons = icons.filter((id) => String(id).includes(search));
		}

		const total = icons.length;
		const slice = icons.slice(offset, offset + limit);
		return apiOk({ icons: slice, total });
	},
);
