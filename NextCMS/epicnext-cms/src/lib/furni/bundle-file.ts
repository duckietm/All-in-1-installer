import { existsSync } from "node:fs";
import path from "node:path";
import { LOCAL_BUNDLE_EXT, LOCAL_BUNDLE_EXTS } from "./classname";

/**
 * Local furniture-bundle lookups.
 *
 * New bundles are written with the configured primary extension
 * (`FURNI_BUNDLE_EXT`, `.hab` by default), but a large body of pre-existing
 * assets may be `.nitro`, so every existence check has to consider both. These
 * helpers are the single place that knows that, which keeps "is this item's
 * asset present?" from silently flipping to `false` for legacy files and the
 * nitro-cleanup scan from classifying them as fake leftovers.
 *
 * Remote URLs deliberately do NOT go through here: sources still serve `.nitro`.
 */

export function bundleFileNames(base: string): string[] {
	return LOCAL_BUNDLE_EXTS.map((ext) => `${base}${ext}`);
}

/** The classname stem of a bundle file name, or null for any other extension. */
export function stripBundleExt(fileName: string): string | null {
	for (const ext of LOCAL_BUNDLE_EXTS) {
		if (fileName.toLowerCase().endsWith(ext)) {
			return fileName.slice(0, -ext.length);
		}
	}
	return null;
}

/** Path of `base`'s bundle inside `dir`, or null when neither extension is there. */
export function resolveBundleInDir(dir: string, base: string): string | null {
	for (const fileName of bundleFileNames(base)) {
		const candidate = path.join(dir, fileName);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** File name of `base`'s bundle inside `dir`, preferring `.hab`. */
export function resolveBundleFileNameInDir(
	dir: string,
	base: string,
): string | null {
	for (const fileName of bundleFileNames(base)) {
		if (existsSync(path.join(dir, fileName))) return fileName;
	}
	return null;
}

export function bundleExistsInDir(dir: string, base: string): boolean {
	return resolveBundleInDir(dir, base) !== null;
}

/** True when the bundle exists in `dir` or in any mirror dir. */
export function bundleExistsInDirs(dirs: string[], base: string): boolean {
	return dirs.some((dir) => bundleExistsInDir(dir, base));
}

/** First hit across `dirs`, primary first — callers pass the primary dir first. */
export function resolveBundleInDirs(
	dirs: string[],
	base: string,
): string | null {
	for (const dir of dirs) {
		const found = resolveBundleInDir(dir, base);
		if (found) return found;
	}
	return null;
}

/**
 * The path a newly imported bundle should be written to. Colliding with an
 * existing `.nitro` is reported so the caller can decide — writing `.hab`
 * beside a live `.nitro` would leave two competing bundles.
 */
export function bundleWritePathInDir(dir: string, base: string): string {
	return path.join(dir, `${base}${LOCAL_BUNDLE_EXT}`);
}

/** Every existing bundle file for `base`, across all dirs — for cleanup/deletes. */
export function existingBundlePaths(dirs: string[], base: string): string[] {
	const out: string[] = [];
	for (const dir of dirs) {
		for (const fileName of bundleFileNames(base)) {
			const candidate = path.join(dir, fileName);
			if (existsSync(candidate)) out.push(candidate);
		}
	}
	return out;
}
