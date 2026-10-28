import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { db, Items, ItemsBase, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { loadRoom } from "../../_lib/load-room";
import { FurniClient } from "./furni-client";

export default async function RoomFurniPage({
	params,
}: {
	params: Promise<{ id: string; locale: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ROOMS_VIEW, session.user.rank))
		redirect("/admin");

	const room = await loadRoom(id);

	// Load items in this room. items.item_id → items_base.id
	const items = await db
		.select()
		.from(Items)
		.where(eq(Items.roomId, room.id))
		.orderBy(desc(Items.id));

	// Resolve item bases
	const baseIds = Array.from(
		new Set(
			items.map((i) => i.itemId).filter((id): id is number => id !== null),
		),
	);
	const bases = baseIds.length
		? await db
				.select({
					id: ItemsBase.id,
					itemName: ItemsBase.itemName,
					publicName: ItemsBase.publicName,
					type: ItemsBase.type,
				})
				.from(ItemsBase)
				.where(inArray(ItemsBase.id, baseIds))
		: [];
	const baseMap = new Map(bases.map((b) => [b.id, b]));

	// Resolve owner usernames
	const userIds = Array.from(
		new Set(items.map((i) => i.userId).filter((u) => u > 0)),
	);
	const users = userIds.length
		? await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, userIds))
		: [];
	const userMap = new Map(users.map((u) => [u.id, u.username]));

	const rows = items.map((i) => {
		const base = i.itemId === null ? undefined : baseMap.get(i.itemId);
		return {
			id: i.id,
			baseId: i.itemId ?? 0,
			name: base?.publicName || base?.itemName || `#${i.itemId}`,
			itemName: base?.itemName ?? "",
			type: base?.type ?? "?",
			x: i.x,
			y: i.y,
			z: i.z,
			rot: i.rot,
			wallPos: i.wallPos,
			userId: i.userId,
			ownerUsername: userMap.get(i.userId) ?? null,
			extraData: i.extraData,
		};
	});

	return (
		<div className="space-y-6">
			<AdminBreadcrumb
				items={[
					{ label: "Rooms", href: "/admin/rooms" },
					{ label: room.name, href: `/admin/rooms/show/${room.id}` },
					{ label: "Furniture" },
				]}
			/>
			<FurniClient
				room={{
					id: room.id,
					name: room.name,
					ownerUsername: room.owner?.username ?? room.ownerName,
				}}
				items={rows}
				canEdit={canAccess(permissions, PERMS.ROOMS_EDIT, session.user.rank)}
			/>
		</div>
	);
}
