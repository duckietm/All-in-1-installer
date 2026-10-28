import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteShopVouchers } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { type VoucherRow, VouchersClient } from "./vouchers-client";

export default async function AdminVouchers() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.SHOP_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canEdit = canAccess(permissions, PERMS.SHOP_EDIT, session.user.rank);
	const now = Date.now();

	let rows: VoucherRow[] = [];
	try {
		const vouchers = await db
			.select({
				id: WebsiteShopVouchers.id,
				code: WebsiteShopVouchers.code,
				amount: WebsiteShopVouchers.amount,
				maxUses: WebsiteShopVouchers.maxUses,
				useCount: WebsiteShopVouchers.useCount,
				expiresAt: WebsiteShopVouchers.expiresAt,
				createdAt: WebsiteShopVouchers.createdAt,
			})
			.from(WebsiteShopVouchers)
			.orderBy(desc(WebsiteShopVouchers.id))
			.limit(200);
		rows = vouchers.map((v) => {
			const expired = v.expiresAt ? v.expiresAt.getTime() <= now : false;
			const usedUp = v.maxUses > 0 && v.useCount >= v.maxUses;
			const status: VoucherRow["status"] = expired
				? "expired"
				: usedUp
					? "usedUp"
					: "active";
			return {
				id: String(v.id),
				code: v.code,
				amount: v.amount,
				maxUses: v.maxUses,
				useCount: v.useCount,
				expiresAt: v.expiresAt?.toISOString() ?? null,
				createdAt: v.createdAt?.toISOString() ?? null,
				status,
			};
		});
	} catch {
		rows = [];
	}

	const stats = {
		total: rows.length,
		active: rows.filter((v) => v.status === "active").length,
		usedUp: rows.filter((v) => v.status === "usedUp").length,
		expired: rows.filter((v) => v.status === "expired").length,
	};

	return <VouchersClient vouchers={rows} canEdit={canEdit} stats={stats} />;
}
