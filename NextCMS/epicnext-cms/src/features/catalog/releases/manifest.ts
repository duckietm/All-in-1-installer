import { createHash } from "node:crypto";

export const CATALOG_RELEASE_MANIFEST_PATH = "Gamedata/catalog-release.json";
export interface ReleaseFile {
	path: string;
	bytes: number;
	sha256: string;
}
export interface ReleaseManifest {
	schemaVersion: 1;
	scope: "exported-files";
	absentFiles: "preserve";
	releaseId: string;
	files: ReleaseFile[];
}

export function createReleaseManifest(entries: ReleaseFile[]): ReleaseManifest {
	const seen = new Set<string>();
	const files = entries
		.map(({ path, bytes, sha256 }) => {
			if (
				typeof path !== "string" ||
				!path ||
				path.startsWith("/") ||
				/[\\:]/.test(path) ||
				Array.from(path).some((character) => character.charCodeAt(0) < 32) ||
				path
					.split("/")
					.some(
						(part) =>
							!part ||
							part === "." ||
							part === ".." ||
							part.toLowerCase() === ".git",
					) ||
				path === CATALOG_RELEASE_MANIFEST_PATH ||
				seen.has(path)
			)
				throw new Error("Invalid release path");
			if (
				!Number.isSafeInteger(bytes) ||
				bytes < 0 ||
				!/^[a-f0-9]{64}$/.test(sha256)
			)
				throw new Error("Invalid release digest");
			seen.add(path);
			return { path, bytes, sha256 };
		})
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const body = {
		schemaVersion: 1 as const,
		scope: "exported-files" as const,
		absentFiles: "preserve" as const,
		files,
	};
	return {
		...body,
		releaseId: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`,
	};
}

export async function validateReleaseManifest(
	manifest: ReleaseManifest,
	readDigest: (path: string) => Promise<{ bytes: number; sha256: string }>,
): Promise<void> {
	const expected = createReleaseManifest(manifest.files);
	if (
		manifest.schemaVersion !== 1 ||
		manifest.scope !== expected.scope ||
		manifest.absentFiles !== expected.absentFiles ||
		manifest.releaseId !== expected.releaseId
	)
		throw new Error("Catalog release identity mismatch");
	for (const file of expected.files) {
		const actual = await readDigest(file.path);
		if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
			throw new Error(`Catalog release bytes mismatch: ${file.path}`);
	}
}
