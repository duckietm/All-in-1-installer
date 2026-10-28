import { unlink } from "node:fs/promises";
import path from "node:path";
import { getRuntimeResolve } from "@/lib/utils/runtime-path";

/**
 * Best-effort local file delete for camera photos hosted under /public.
 * External CDN URLs are left alone (no purge credentials in this CMS).
 */
export async function tryRemoveLocalPhotoFile(url: string): Promise<boolean> {
	if (!url?.trim()) return false;
	let pathname = url.trim();
	if (/^https?:\/\//i.test(pathname)) {
		try {
			const parsed = new URL(pathname);
			const app = (process.env.APP_URL || "").replace(/\/$/, "");
			if (!app || !pathname.startsWith(app)) return false;
			pathname = parsed.pathname;
		} catch {
			return false;
		}
	}
	if (!pathname.startsWith("/")) return false;
	const rel = pathname.replace(/^\/+/, "");
	if (!rel || rel.includes("..")) return false;
	const publicRoot = /*turbopackIgnore: true*/ getRuntimeResolve(
		process.cwd(),
		"public",
	);
	const full = getRuntimeResolve(publicRoot, rel);
	if (!full.startsWith(publicRoot + path.sep) && full !== publicRoot) {
		return false;
	}
	try {
		await unlink(full);
		return true;
	} catch {
		return false;
	}
}
