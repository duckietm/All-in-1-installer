"use server";

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { toBadgeGif } from "@/lib/images/badge-gif";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// Writes a badge image to the configured emulator badge directory. The path is
// read from BADGE_UPLOAD_DIR so deployments can point it at their emulator's
// `swf/c_images/album1584` (or equivalent) without code changes. AtomCMS only
// ever stores .gif badges, so every upload is normalised to `<code>.gif`.

const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 1024 * 1024; // 1MB
const ALLOWED_TYPES = new Set(["image/gif", "image/png"]);

function back(param: string, value: string): never {
	redirect(`/admin/badges?${param}=${encodeURIComponent(value)}`);
}

export async function uploadBadge(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);

	const dir = process.env.BADGE_UPLOAD_DIR;
	if (!dir) {
		back("error", "Badge upload directory not configured");
	}

	const code = String(formData.get("code") ?? "")
		.normalize("NFC")
		.trim();
	if (!CODE_RE.test(code)) {
		back("error", "Invalid badge code (use A-Z, 0-9, _ or -, max 64 chars)");
	}

	const file = formData.get("file");
	if (!(file instanceof File)) {
		back("error", "No file uploaded");
	}

	if (file.size === 0) {
		back("error", "Uploaded file is empty");
	}
	if (file.size > MAX_BYTES) {
		back("error", "File too large (max 1MB)");
	}
	if (!ALLOWED_TYPES.has(file.type)) {
		back("error", "File must be a GIF or PNG image");
	}

	const baseDir = path.resolve(dir);
	const target = path.resolve(baseDir, `${code}.gif`);
	if (!target.startsWith(baseDir + path.sep)) {
		back("error", "Invalid path");
	}

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const gif = await toBadgeGif(buffer);
		await writeFile(target, gif);
	} catch {
		back("error", "Could not process or write the badge file");
	}

	await logStaffActivity({
		staffId: staff.id,
		action: "badge_upload",
		description: `Uploaded badge image "${code}.gif"`,
		targetType: "badge",
	});

	redirect(`/admin/badges?uploaded=${encodeURIComponent(code)}`);
}
