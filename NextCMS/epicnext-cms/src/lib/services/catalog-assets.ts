import { promises as fs } from "node:fs";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export function catalogueAssetDirectories(
	gamedataRoot: string,
	cwd = process.cwd(),
): string[] {
	const bundled = getRuntimePath(cwd, "public", "swf", "c_images", "catalogue");
	if (!gamedataRoot.trim()) return [bundled];

	return [getRuntimePath(gamedataRoot, "c_images", "catalogue"), bundled];
}

export async function readCatalogueAssetFiles(
	directories: string[],
): Promise<string[]> {
	const files = new Set<string>();
	for (const directory of directories) {
		try {
			for (const file of await fs.readdir(directory)) files.add(file);
		} catch {
			// A missing optional source must not hide assets from the other source.
		}
	}
	return [...files];
}
