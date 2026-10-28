export const CATALOGUE_ASSET_BASE_PATH = "/gamedata/c_images/catalogue";

export type CatalogueImageExtension = "png" | "gif";

/**
 * A handful of catalogue icons only exist as `.gif`, so callers must be able to
 * retry with `"gif"` after the `.png` attempt 404s. Defaults to `"png"`, which
 * is what every icon except a few uses.
 */
export function catalogueIconUrl(
	iconImage: number,
	extension: CatalogueImageExtension = "png",
): string {
	return `${CATALOGUE_ASSET_BASE_PATH}/icon_${iconImage}.${extension}`;
}

export function catalogueAssetUrl(
	name: string,
	extension: CatalogueImageExtension,
): string {
	return `${CATALOGUE_ASSET_BASE_PATH}/${encodeURIComponent(name)}.${extension}`;
}
