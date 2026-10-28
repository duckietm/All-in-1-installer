"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { validateSiteImageUpload } from "@/lib/images/site-image-upload";
import { logger } from "@/lib/logger";
import { resolveMediaPath } from "@/lib/media-storage";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

export async function saveLogo(
	formData: FormData,
): Promise<{ success: boolean; url?: string; error?: string }> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	try {
		const upload = await validateSiteImageUpload(
			formData instanceof FormData ? formData.get("file") : null,
		);
		if (!upload.success) return upload;
		const ext = upload.extension;
		const filename = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
		const baseDir = resolveMediaPath("logo");
		const filePath = path.resolve(baseDir, filename);
		if (!filePath.startsWith(baseDir + path.sep)) {
			return { success: false, error: "Invalid path" };
		}

		const buffer = upload.bytes;
		await mkdir(baseDir, { recursive: true });
		await writeFile(filePath, buffer);

		const url = `/api/media/logo/${filename}`;

		await db
			.insert(WebsiteSetting)
			.values({ key: "cms_logo", value: url, comment: "Logo (generator)" })
			.onDuplicateKeyUpdate({ set: { value: url } });

		siteSettings.reload();
		revalidatePath("/", "layout");

		return { success: true, url };
	} catch {
		logger.error("Site logo update failed", { module: "site-images" });
		return { success: false, error: "Could not update site logo" };
	}
}
