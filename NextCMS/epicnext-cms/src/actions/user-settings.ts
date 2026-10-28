"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, User } from "@/lib/db";
import { actionOk, authAction } from "@/lib/foundation/action";
import { DatabaseError } from "@/lib/foundation/errors";
import { isAllowed } from "@/lib/services/moderation";
import { rcon } from "@/lib/services/rcon";

const MOTTO_MAX = 127;

const mottoSchema = z.object({
	motto: z
		.string()
		.max(MOTTO_MAX, `Motto must be at most ${MOTTO_MAX} characters`),
});

async function assertMottoAllowed(motto: string): Promise<void> {
	if (!(await isAllowed(motto)).ok) {
		throw new DatabaseError("Motto not allowed");
	}
}

const updateMottoAction = authAction({ schema: mottoSchema }, async (ctx) => {
	await assertMottoAllowed(ctx.data.motto);
	try {
		await db
			.update(User)
			.set({ motto: ctx.data.motto })
			.where(eq(User.id, ctx.session.user.id));
	} catch {
		throw new DatabaseError("Failed to update motto");
	}

	try {
		await rcon.setMotto(ctx.session.user.id, ctx.data.motto);
	} catch {
		// RCON is best-effort; the change is already persisted.
	}

	revalidatePath("/settings");
	return actionOk();
});

export async function updateMotto(formData: FormData): Promise<void> {
	const motto = String(formData.get("motto") ?? "")
		.normalize("NFC")
		.slice(0, MOTTO_MAX);
	await updateMottoAction({ motto });
}

export { updateMottoAction };
