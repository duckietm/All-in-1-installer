"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, Items, Rooms } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { notify } from "@/lib/services/webhook";

// Only these columns may be patched from the client. Spreading the whole payload
// into `.set()` let a caller rewrite roomId/userId/extraData of any row, which
// is mass assignment and IDOR in one.
const ROOM_ITEM_FIELDS = [
	"wallPos",
	"x",
	"y",
	"z",
	"rot",
	"extraData",
	"wiredData",
	"limitedData",
	"guildId",
] as const;

const ROOM_FIELDS = ["name", "description", "state", "usersMax"] as const;

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

function toPositiveInt(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}

export async function updateRoomItem(payload: Record<string, unknown>) {
	const staff = await requirePermission(PERMS.ROOMS_EDIT);
	const roomId = toPositiveInt(payload.roomId);
	const itemId = toPositiveInt(payload.itemId);
	if (!roomId || !itemId) {
		throw new Error("Invalid room or item id");
	}
	// The item must belong to the room the staff member is editing.
	const [item] = await db
		.select({ id: Items.id })
		.from(Items)
		.where(and(eq(Items.id, itemId), eq(Items.roomId, roomId)))
		.limit(1);
	if (!item) throw new Error("Item not found in this room");

	await db
		.update(Items)
		.set(
			pickAllowed(payload, ROOM_ITEM_FIELDS) as Partial<
				typeof Items.$inferInsert
			>,
		)
		.where(eq(Items.id, itemId));
	await logStaffActivity({
		staffId: staff.id,
		action: "room_item_update",
		description: `Updated item #${itemId} in room #${roomId}`,
		targetType: "room_item",
		targetId: itemId,
	});
	revalidatePath(`/admin/rooms/${roomId}/furni`);
}

export async function bulkDeleteRoomItems({
	roomId,
	itemIds,
}: {
	roomId: number;
	itemIds: number[];
}) {
	const staff = await requirePermission(PERMS.ROOMS_EDIT);
	await db
		.delete(Items)
		.where(and(inArray(Items.id, itemIds), eq(Items.roomId, roomId)));
	await logStaffActivity({
		staffId: staff.id,
		action: "room_items_bulk_delete",
		description: `Deleted ${itemIds.length} item(s) from room #${roomId}`,
		targetType: "room_item",
	});
	revalidatePath(`/admin/rooms/${roomId}/furni`);
}

export async function deleteRoomItem({
	roomId,
	itemId,
}: {
	roomId: number;
	itemId: number;
}) {
	const staff = await requirePermission(PERMS.ROOMS_EDIT);
	await db.delete(Items).where(eq(Items.id, itemId));
	await logStaffActivity({
		staffId: staff.id,
		action: "room_item_delete",
		description: `Deleted item #${itemId} from room #${roomId}`,
		targetType: "room_item",
		targetId: itemId,
	});
	revalidatePath(`/admin/rooms/${roomId}/furni`);
}

export async function roomRconAction({
	roomId,
	action,
}: {
	roomId: number;
	action: string;
}) {
	const staff = await requirePermission(PERMS.ROOMS_EDIT);
	if (action === "reload") {
		await rcon.send("reloadroom", { room_id: roomId });
	} else if (action === "kick") {
		await rcon.send("kickall", { room_id: roomId });
		notify({
			action: "kick",
			actor: staff.username,
			target: String(roomId),
			details: action,
		});
	} else if (action === "lock") {
		await rcon.send("updateroom", { room_id: roomId, state: "locked" });
	} else if (action === "unlock") {
		await rcon.send("updateroom", { room_id: roomId, state: "open" });
	}
}

export async function deleteRoom({ id }: { id: number }) {
	const staff = await requirePermission(PERMS.ROOMS_DELETE);
	const [room] = await db
		.select({ name: Rooms.name })
		.from(Rooms)
		.where(eq(Rooms.id, id))
		.limit(1);
	await db.delete(Rooms).where(eq(Rooms.id, id));
	await logStaffActivity({
		staffId: staff.id,
		action: "room_delete",
		description: `Deleted room #${id}`,
		targetType: "room",
		targetId: id,
	});
	notify({
		action: "room_delete",
		actor: staff.username,
		target: room?.name ?? `#${id}`,
	});
	revalidatePath("/admin/rooms");
}

export async function updateRoom({ id, ...data }: Record<string, unknown>) {
	const staff = await requirePermission(PERMS.ROOMS_EDIT);
	const roomId = toPositiveInt(id);
	if (!roomId) throw new Error("Invalid room id");
	await db
		.update(Rooms)
		.set(pickAllowed(data, ROOM_FIELDS) as Partial<typeof Rooms.$inferInsert>)
		.where(eq(Rooms.id, roomId));
	await logStaffActivity({
		staffId: staff.id,
		action: "room_update",
		description: `Updated room #${roomId}`,
		targetType: "room",
		targetId: roomId,
	});
	revalidatePath(`/admin/rooms/${roomId}`);
}
