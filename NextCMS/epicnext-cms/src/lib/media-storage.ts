import path from "node:path";
import { getRuntimeResolve } from "@/lib/utils/runtime-path";

/**
 * Persistent media root. Lives outside `public/` and outside Git so uploads
 * survive rebuilds, redeploys and `git clean`. Served through /api/media.
 */
export const MEDIA_ROOT = getRuntimeResolve(process.cwd(), "storage", "media");

export function resolveMediaPath(...segments: string[]): string {
	const target = getRuntimeResolve(MEDIA_ROOT, ...segments);
	if (target !== MEDIA_ROOT && !target.startsWith(MEDIA_ROOT + path.sep)) {
		throw new Error("Invalid media path");
	}
	return target;
}
