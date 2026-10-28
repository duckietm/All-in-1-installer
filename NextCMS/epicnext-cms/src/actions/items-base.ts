"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, ItemsBase } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";

const ITEMS_BASE_FIELDS = [
	"publicName",
	"itemName",
	"type",
	"spriteId",
	"width",
	"length",
	"stackHeight",
	"allowStack",
	"allowSit",
	"allowLay",
	"allowWalk",
	"allowGift",
	"allowTrade",
	"allowRecycle",
	"allowMarketplaceSell",
	"allowInventoryStack",
	"interactionType",
	"interactionModesCount",
	"vendingIds",
	"multiheight",
	"customparams",
	"effectIdMale",
	"effectIdFemale",
	"clothingOnWalk",
] as const;

const updateSchema = z.object({
	id: z.coerce.number().int().positive(),
	fields: z.record(z.string(), z.unknown()),
});

function pickAllowed(
	fields: Record<string, unknown>,
	allowed: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of allowed) {
		if (Object.hasOwn(fields, key) && fields[key] !== undefined) {
			out[key] = fields[key];
		}
	}
	return out;
}

export const updateItemsBase = adminAction(
	{ permission: PERMS.CATALOG_EDIT, schema: updateSchema },
	async (ctx) => {
		const { id, fields } = ctx.data;
		const safe = pickAllowed(fields, ITEMS_BASE_FIELDS);
		if (Object.keys(safe).length === 0) {
			throw new ActionError("No valid fields to update");
		}

		const [existing] = await db
			.select({ id: ItemsBase.id })
			.from(ItemsBase)
			.where(eq(ItemsBase.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Item not found");

		// Coerce common numeric / decimal fields from form strings.
		const data: Record<string, unknown> = { ...safe };
		for (const key of [
			"spriteId",
			"width",
			"length",
			"allowStack",
			"allowSit",
			"allowLay",
			"allowWalk",
			"allowGift",
			"allowTrade",
			"allowRecycle",
			"allowMarketplaceSell",
			"allowInventoryStack",
			"interactionModesCount",
			"effectIdMale",
			"effectIdFemale",
		]) {
			if (data[key] !== undefined) data[key] = Number(data[key]);
		}
		if (data.stackHeight !== undefined) {
			data.stackHeight = Number(data.stackHeight);
		}

		await db
			.update(ItemsBase)
			.set(data as Partial<typeof ItemsBase.$inferInsert>)
			.where(eq(ItemsBase.id, id));
		await rcon.updateCatalog().catch(() => false);
		await logStaffActivity({
			staffId: Number(ctx.session.user.id),
			action: "items_base_update",
			description: `Updated items_base #${id}`,
			targetType: "items_base",
			targetId: id,
		});
		revalidatePath("/admin/items");
		revalidatePath(`/admin/items/${id}`);
		revalidatePath("/admin/catalog");
		return actionOk({ id });
	},
);
