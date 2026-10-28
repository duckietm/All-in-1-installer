import { asc, eq, like, or } from "drizzle-orm";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

/**
 * Search items_base for Quick Add / catalog tooling.
 * GET ?q=…&limit=30
 */
export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const q = (request.nextUrl.searchParams.get("q") || "").trim();
		const limit = Math.min(
			Math.max(
				Number.parseInt(
					request.nextUrl.searchParams.get("limit") || "30",
					10,
				) || 30,
				1,
			),
			50,
		);

		if (q.length < 2) {
			return apiOk({ results: [] });
		}

		const idExact = Number.parseInt(q, 10);
		const conditions = [
			like(ItemsBase.itemName, `%${q}%`),
			like(ItemsBase.publicName, `%${q}%`),
		];
		if (Number.isFinite(idExact) && String(idExact) === q) {
			conditions.push(eq(ItemsBase.id, idExact));
		}

		const rows = await db
			.select({
				id: ItemsBase.id,
				itemName: ItemsBase.itemName,
				publicName: ItemsBase.publicName,
				type: ItemsBase.type,
				spriteId: ItemsBase.spriteId,
				interactionType: ItemsBase.interactionType,
			})
			.from(ItemsBase)
			.where(or(...conditions))
			.orderBy(asc(ItemsBase.id))
			.limit(limit);

		return apiOk({
			results: rows.map((r) => ({
				id: r.id,
				itemName: r.itemName ?? "",
				publicName: r.publicName ?? "",
				type: r.type ?? "s",
				spriteId: r.spriteId ?? 0,
				interactionType: r.interactionType ?? "default",
			})),
		});
	},
);
