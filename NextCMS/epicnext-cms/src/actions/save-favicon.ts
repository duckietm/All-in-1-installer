"use server";

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { validateSiteImageUpload } from "@/lib/images/site-image-upload";
import { logger } from "@/lib/logger";
import { resolveMediaPath } from "@/lib/media-storage";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";

export async function saveFavicon(
	formData: FormData,
): Promise<{ success: boolean; url?: string; error?: string }> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	try {
		const upload = await validateSiteImageUpload(
			formData instanceof FormData ? formData.get("file") : null,
			{ allowIcon: true },
		);
		if (!upload.success) return upload;
		const ext = upload.extension;
		const filename = `favicon-${Date.now()}.${ext}`;
		const baseDir = resolveMediaPath("favicon");
		const filePath = path.resolve(baseDir, filename);
		if (!filePath.startsWith(baseDir + path.sep)) {
			return { success: false, error: "Invalid path" };
		}

		const buffer = upload.bytes;
		await mkdir(baseDir, { recursive: true });
		await writeFile(filePath, buffer);

		const url = `/api/media/favicon/${filename}`;

		// Remove old favicon file if it exists
		const oldUrl = await siteSettings.get("cms_favicon");
		if (oldUrl?.startsWith("/api/media/favicon/")) {
			const oldName = oldUrl.replace("/api/media/favicon/", "");
			if (!oldName.includes("..") && !oldName.includes("/")) {
				const oldPath = path.resolve(baseDir, oldName);
				if (oldPath.startsWith(baseDir + path.sep)) {
					try {
						await unlink(oldPath);
					} catch {
						/* ignore if file doesn't exist */
					}
				}
			}
		}

		await db
			.insert(WebsiteSetting)
			.values({ key: "cms_favicon", value: url, comment: "Favicon URL" })
			.onDuplicateKeyUpdate({ set: { value: url } });

		siteSettings.reload();
		revalidatePath("/", "layout");
		revalidatePath("/admin/favicon");

		return { success: true, url };
	} catch {
		logger.error("Site favicon update failed", { module: "site-images" });
		return { success: false, error: "Could not update site favicon" };
	}
}

export async function deleteFavicon(): Promise<{
	success: boolean;
	error?: string;
}> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	try {
		const oldUrl = await siteSettings.get("cms_favicon");
		if (oldUrl?.startsWith("/api/media/favicon/")) {
			const baseDir = resolveMediaPath("favicon");
			const oldName = oldUrl.replace("/api/media/favicon/", "");
			if (!oldName.includes("..") && !oldName.includes("/")) {
				const oldPath = path.resolve(baseDir, oldName);
				if (oldPath.startsWith(baseDir + path.sep)) {
					try {
						await unlink(oldPath);
					} catch {
						/* ignore */
					}
				}
			}
		}

		try {
			await db
				.delete(WebsiteSetting)
				.where(eq(WebsiteSetting.key, "cms_favicon"));
		} catch {
			/* ignore missing row */
		}
		siteSettings.reload();
		revalidatePath("/", "layout");
		revalidatePath("/admin/favicon");

		return { success: true };
	} catch {
		logger.error("Site favicon update failed", { module: "site-images" });
		return { success: false, error: "Could not update site favicon" };
	}
}
