"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { db, MarketplaceItems } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

/** Cancel an active marketplace listing (state 1 → 0). */
export async function cancelMarketplaceListing(
	formData: FormData,
): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.SHOP_EDIT);
	const id = Number(formData.get("id"));
	if (!(id > 0)) return;

	const [listing] = await db
		.select({
			id: MarketplaceItems.id,
			state: MarketplaceItems.state,
			userId: MarketplaceItems.userId,
			itemId: MarketplaceItems.itemId,
			price: MarketplaceItems.price,
		})
		.from(MarketplaceItems)
		.where(eq(MarketplaceItems.id, id))
		.limit(1);
	if (listing?.state !== 1) return;

	await db
		.update(MarketplaceItems)
		.set({ state: 0 })
		.where(eq(MarketplaceItems.id, id));

	await logStaffActivity({
		staffId: staff.id,
		action: "marketplace_cancel",
		description: `Cancelled marketplace listing #${id} (item ${listing.itemId}, user ${listing.userId}, price ${listing.price})`,
		targetType: "marketplace",
		targetId: id,
	});
	revalidatePath("/admin/marketplace");
}
