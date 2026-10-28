"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { tryRemoveLocalPhotoFile } from "@/lib/admin/photo-files";
import { CameraWeb, db } from "@/lib/db";
import { EDGE_CACHE_TAGS, purgeEdgeCache } from "@/lib/edge-cache";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

export async function deletePhoto(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const id = Number(formData.get("id"));
	if (!(id > 0)) return;

	const [row] = await db
		.select({ id: CameraWeb.id, url: CameraWeb.url })
		.from(CameraWeb)
		.where(eq(CameraWeb.id, id))
		.limit(1);

	if (row) {
		await db.delete(CameraWeb).where(eq(CameraWeb.id, id));
		await tryRemoveLocalPhotoFile(row.url);
		await logStaffActivity({
			staffId: staff.id,
			action: "photo_delete",
			description: `Deleted camera photo #${id}`,
			targetType: "camera_web",
			targetId: id,
		});
	}

	revalidatePath("/admin/photos");
	revalidatePath("/photos");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "photo deleted");
}
