import { promises as fs } from "node:fs";
import sharp from "sharp";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { resolveBundleInDir } from "@/lib/furni/bundle-file";
import {
	buildNitroCompressionReport,
	inspectNitroScales,
	object,
	resolveNitroFrame,
} from "@/lib/furni/nitro-quality";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import { parseNitroBundle } from "@/lib/services/swf/nitro-builder";
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const classname = request.nextUrl.searchParams.get("classname");
		if (!validateClassnames([classname]))
			return apiError("Invalid classname", 400);
		const base = String(classname).split("*")[0],
			{ nitroDir } = await getFurniAssetDirs();
		try {
			const bundlePath = resolveBundleInDir(
				/*turbopackIgnore: true*/ nitroDir,
				base,
			);
			if (!bundlePath) return apiError("Bundle file not found", 404);
			const parsed = parseNitroBundle(await fs.readFile(bundlePath));
			const { json, texture } = parsed;
			const image = await sharp(texture).metadata();
			if (!image.width || !image.height)
				return apiError("Invalid bundle texture", 422);
			const asset = request.nextUrl.searchParams.get("asset");
			if (asset) {
				if (!Object.hasOwn(object(json.assets), asset))
					return apiError("Sprite not found", 404);
				const resolved = resolveNitroFrame(json, asset),
					rect = object(resolved.frame.frame);
				let pipeline = sharp(texture).extract({
					left: Number(rect.x),
					top: Number(rect.y),
					width: Number(rect.w),
					height: Number(rect.h),
				});
				if (resolved.frame.rotated) pipeline = pipeline.rotate(270);
				if (resolved.flipH) pipeline = pipeline.flop();
				if (resolved.flipV) pipeline = pipeline.flip();
				const buffer = await pipeline.png().toBuffer();
				return new Response(new Uint8Array(buffer), {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": "private, no-store",
					},
				});
			}
			return apiOk({
				report: {
					...inspectNitroScales(json, image.width, image.height),
					compression: await buildNitroCompressionReport(parsed),
				},
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return apiError("Nitro file not found", 404);
			return apiError("Cannot inspect this Nitro bundle or sprite", 422);
		}
	},
);
