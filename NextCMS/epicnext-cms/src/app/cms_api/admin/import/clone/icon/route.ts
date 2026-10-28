import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { assertSafeImportUrl } from "@/lib/import-url-safety";
import { PERMS } from "@/lib/permissions";
import { extractFurniIconPng } from "@/lib/services/clone-icon";
import { getSource } from "@/lib/services/clone-sources";

// In-process cache of extracted icons, keyed by source+classname.
// null = known-missing (don't refetch the bundle every render).
const iconCache = new Map<string, Buffer | null>();
const MAX_ICON_CACHE_SIZE = 500;

function pruneIconCache() {
	while (iconCache.size > MAX_ICON_CACHE_SIZE) {
		const oldest = iconCache.keys().next().value;
		if (oldest === undefined) break;
		iconCache.delete(oldest);
	}
}

// GET ?source=<id>&classname=<cn>
// Fetches the source's .nitro bundle and returns the embedded furni icon as a
// PNG. Used by the clone preview grid for sources that don't serve standalone
// {classname}_icon.png files (icons live inside the .nitro).
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const sp = request.nextUrl.searchParams;
		const sourceId = sp.get("source");
		const classname = sp.get("classname");
		if (!sourceId || !classname)
			return apiError("Missing source or classname", 400);
		if (!/^[\w\-.*]+$/.test(classname))
			return apiError("Invalid classname", 400);

		const cacheKey = `${sourceId}:${classname}`;
		let icon = iconCache.get(cacheKey);

		if (icon === undefined) {
			const source = await getSource(sourceId);
			if (!source) return apiError("Source not found", 404);
			if (!source.nitroBaseUrl)
				return apiError("Source has no nitro base URL", 400);
			try {
				await assertSafeImportUrl(source.nitroBaseUrl, "nitroBaseUrl");
			} catch (err) {
				return apiError((err as Error).message, 400);
			}
			try {
				const res = await fetch(
					`${source.nitroBaseUrl.replace(/\/+$/, "")}/${classname}.nitro`,
					{
						signal: AbortSignal.timeout(15000),
					},
				);
				if (!res.ok) {
					iconCache.set(cacheKey, null);
					return apiError("Bundle not found", 404);
				}
				icon = await extractFurniIconPng(Buffer.from(await res.arrayBuffer()));
				iconCache.set(cacheKey, icon);
				pruneIconCache();
			} catch {
				iconCache.set(cacheKey, null);
				return apiError("Failed to fetch bundle", 502);
			}
		}

		if (!icon) return apiError("No icon in bundle", 404);

		return new Response(new Uint8Array(icon), {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=86400",
			},
		});
	},
);
