import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * True when a site-relative URL points at a file that really exists under
 * `public/`. CMS records can keep pointing at an upload that has since been
 * deleted, and a stale reference renders a broken image (or a 404 background
 * layer) on every page view. Server-only: it stats the filesystem.
 *
 * Remote URLs (`http:`, `https:`, protocol-relative) are trusted as-is because
 * we cannot stat them, and data/blob URIs are rejected outright.
 */
export function publicAssetExists(url: string | null | undefined): boolean {
	if (!url) return false;
	if (url.startsWith("//")) return true;
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		return /^https?:/i.test(url);
	}
	if (!url.startsWith("/")) return true;
	try {
		const file = decodeURIComponent(url.split(/[?#]/)[0] ?? "");
		return existsSync(join(process.cwd(), "public", file));
	} catch {
		return false;
	}
}
