import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { MEDIA_ROOT } from "@/lib/media-storage";
import { PERMS } from "@/lib/permissions";

/**
 * Directory listing for the admin media picker. It used to be world-readable and
 * unrated, which handed every visitor a complete inventory of uploaded media
 * (logo/favicon paths included) plus their timestamps.
 */
export const GET = withAdmin({ permission: PERMS.PAGES_EDIT }, async () => {
	const dir = MEDIA_ROOT;
	if (!existsSync(dir)) {
		return apiOk({ files: [] });
	}
	const files = readdirSync(dir)
		.filter((f) => /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(f))
		.map((f) => {
			const stat = statSync(resolve(dir, f));
			return {
				name: f,
				url: `/api/media/${f}`,
				size: stat.size,
				uploaded: stat.mtimeMs,
			};
		})
		.sort((a, b) => b.uploaded - a.uploaded);

	return apiOk({ files });
});
