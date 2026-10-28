"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { validateSiteImageUpload } from "@/lib/images/site-image-upload";
import { MEDIA_ROOT, resolveMediaPath } from "@/lib/media-storage";
import { PERMS } from "@/lib/permissions";

/**
 * Store an uploaded media file under MEDIA_ROOT.
 *
 * The extension always comes from the *detected* format (magic bytes + a full
 * sharp decode), never from `file.name` or the browser-supplied MIME type:
 * trusting either lets arbitrary bytes land on disk with an attacker-chosen name
 * that the media route would then serve.
 */
async function storeUploadedMedia(
	file: File,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
	const validated = await validateSiteImageUpload(file);
	if (!validated.success) return { ok: false, error: validated.error };
	const baseDir = MEDIA_ROOT;
	await mkdir(baseDir, { recursive: true });
	const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${validated.extension}`;
	const filePath = resolveMediaPath(name);
	if (!filePath.startsWith(baseDir + path.sep))
		return { ok: false, error: "Invalid path" };
	await writeFile(filePath, validated.bytes);
	return { ok: true, name };
}

export async function uploadMedia(
	formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
	await requirePermission(PERMS.PAGES_EDIT);
	const file = formData.get("file") as File | null;
	if (!file || file.size === 0) return { ok: false, error: "No file provided" };

	const stored = await storeUploadedMedia(file);
	if (!stored.ok) return { ok: false, error: stored.error };

	revalidatePath("/api/media");
	revalidatePath("/admin/media");
	return { ok: true };
}

export async function deleteMedia(name: string): Promise<void> {
	await requirePermission(PERMS.PAGES_EDIT);
	const { unlink } = await import("node:fs/promises");
	const baseDir = MEDIA_ROOT;
	// A name that is not a bare file name never reaches the unlink.
	if (name.includes("/") || name.includes("\\") || name.includes("..")) return;
	const filePath = resolveMediaPath(name);
	if (!filePath.startsWith(baseDir + path.sep)) return;
	try {
		await unlink(filePath);
	} catch {
		// File may not exist
	}
	revalidatePath("/api/media");
	revalidatePath("/admin/media");
}

export async function uploadMediaAndReturn(
	formData: FormData,
): Promise<string> {
	await requirePermission(PERMS.PAGES_EDIT);
	const file = formData.get("file") as File | null;
	if (!file || file.size === 0) return "";

	const stored = await storeUploadedMedia(file);
	if (!stored.ok) return "";

	revalidatePath("/api/media");
	revalidatePath("/admin/media");
	return `/api/media/${stored.name}`;
}
