"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, Soundtracks } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export async function deleteSoundtrack({ id }: { id: number }) {
	await requirePermission(PERMS.CATALOG_EDIT);
	await db.delete(Soundtracks).where(eq(Soundtracks.id, id));
	revalidatePath("/admin/sounds");
}

export async function updateSoundtrack({
	id,
	name,
	author,
	track,
	length,
}: {
	id: number;
	name: string;
	author: string;
	track: string;
	length: number;
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	await db
		.update(Soundtracks)
		.set({ name, author, track, length })
		.where(eq(Soundtracks.id, id));
	revalidatePath("/admin/sounds");
}
