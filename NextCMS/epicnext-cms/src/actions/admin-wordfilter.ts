"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteWordfilter } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import {
	type ActionResult,
	actionError,
	actionOk,
} from "@/lib/safe-action-shared";
import { reloadWordFilter } from "@/lib/services/moderation";
import { rcon } from "@/lib/services/rcon";

export async function addWord(input: {
	word: string;
}): Promise<ActionResult<{ id: string }>> {
	await requirePermission(PERMS.WORDFILTER_EDIT);
	const word = String(input.word ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!word) return actionError("Word is required");

	try {
		const [result] = await db.insert(WebsiteWordfilter).values({ word });
		reloadWordFilter();
		await rcon.updateWordFilter();
		revalidatePath("/admin/wordfilter");
		return actionOk({ id: String(result.insertId) });
	} catch {
		return actionError("Could not add word (it may already exist)");
	}
}

export async function deleteWord(input: { id: string }): Promise<ActionResult> {
	await requirePermission(PERMS.WORDFILTER_EDIT);
	const raw = String(input.id ?? "").normalize("NFC");
	if (!raw) return actionError("Missing word id");

	try {
		await db
			.delete(WebsiteWordfilter)
			.where(eq(WebsiteWordfilter.id, BigInt(raw)));
		reloadWordFilter();
		await rcon.updateWordFilter();
		revalidatePath("/admin/wordfilter");
		return actionOk();
	} catch {
		return actionError("Could not remove word");
	}
}
