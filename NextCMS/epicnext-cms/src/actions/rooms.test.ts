// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	requirePermission: vi.fn(async () => ({
		id: 100,
		rank: 7,
		username: "staff",
	})),
	revalidatePath: vi.fn(),
	del: vi.fn(async () => [{ affectedRows: 1 }]),
	update: vi.fn(async () => [{ affectedRows: 1 }]),
	logStaffActivity: vi.fn(async () => undefined),
	notify: vi.fn(async () => undefined),
	rconSend: vi.fn(async () => undefined),
	roomRows: [] as Array<{ name: string }>,
	denied: false,
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: state.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { ROOMS_EDIT: "admin.room.edit", ROOMS_DELETE: "admin.room.delete" },
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: state.logStaffActivity,
}));
vi.mock("@/lib/services/webhook", () => ({ notify: state.notify }));
vi.mock("@/lib/services/rcon", () => ({ rcon: { send: state.rconSend } }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(
		(_table: unknown, _projection: Record<string, unknown>) => {
			if (state.denied) throw new Error("not allowed");
			return state.roomRows;
		},
	);
	return {
		...schema,
		db: {
			...fake,
			delete: (table: unknown) => ({
				where: (where: unknown) => state.del(table, where),
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) => state.update(table, values, where),
				}),
			}),
		},
	};
});

import { Items, Rooms } from "@/lib/db";
import {
	bulkDeleteRoomItems,
	deleteRoom,
	deleteRoomItem,
	roomRconAction,
	updateRoom,
	updateRoomItem,
} from "./rooms";

describe("rooms actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.denied = false;
		state.roomRows = [{ name: "Lobby" }];
		state.requirePermission.mockResolvedValue({
			id: 100,
			rank: 7,
			username: "staff",
		});
		state.del.mockResolvedValue([{ affectedRows: 1 }]);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		// The item/room ownership lookups must find their row.
		state.roomRows = [{ name: "Lobby" }, { id: 4 }];
	});

	it("requires the ROOMS_EDIT permission for updateRoomItem", async () => {
		// `custom` is not an allow-listed column, so it must never reach `.set()`.
		await updateRoomItem({ roomId: 9, itemId: 4, rot: 4, custom: "x" });
		expect(state.requirePermission).toHaveBeenCalledWith("admin.room.edit");
		expect(state.update).toHaveBeenCalledWith(
			Items,
			{ rot: 4 },
			expect.anything(),
		);
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "room_item_update",
				description: "Updated item #4 in room #9",
				targetType: "room_item",
				targetId: 4,
			}),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms/9/furni");
	});

	it("denies room edits without permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(updateRoomItem({ roomId: 9, itemId: 4 })).rejects.toThrow(
			"forbidden",
		);
		expect(state.update).not.toHaveBeenCalled();
	});

	it("bulk deletes items filtered by room for restricted ids", async () => {
		await bulkDeleteRoomItems({ roomId: 9, itemIds: [1, 2] });
		expect(state.del).toHaveBeenCalledWith(Items, expect.anything());
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "room_items_bulk_delete",
				description: "Deleted 2 item(s) from room #9",
			}),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms/9/furni");
	});

	it("describes an empty bulk delete with a zero count", async () => {
		await bulkDeleteRoomItems({ roomId: 9, itemIds: [] });
		expect(state.del).toHaveBeenCalledWith(Items, expect.anything());
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: "Deleted 0 item(s) from room #9",
			}),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms/9/furni");
	});

	it("deletes a single room item", async () => {
		await deleteRoomItem({ roomId: 9, itemId: 4 });
		expect(state.del).toHaveBeenCalledWith(Items, expect.anything());
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "room_item_delete",
				description: "Deleted item #4 from room #9",
				targetId: 4,
			}),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms/9/furni");
	});

	it("denies bulk and single deletes without permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(
			bulkDeleteRoomItems({ roomId: 9, itemIds: [1] }),
		).rejects.toThrow("forbidden");
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(deleteRoomItem({ roomId: 9, itemId: 1 })).rejects.toThrow(
			"forbidden",
		);
		expect(state.del).not.toHaveBeenCalled();
	});

	it("reloads a room via RCON", async () => {
		await roomRconAction({ roomId: 9, action: "reload" });
		expect(state.rconSend).toHaveBeenCalledWith("reloadroom", { room_id: 9 });
	});

	it("kicks a room via RCON and notifies staff webhooks", async () => {
		await roomRconAction({ roomId: 9, action: "kick" });
		expect(state.rconSend).toHaveBeenCalledWith("kickall", { room_id: 9 });
		expect(state.notify).toHaveBeenCalledWith({
			action: "kick",
			actor: "staff",
			target: "9",
			details: "kick",
		});
	});

	it("locks and unlocks a room via RCON", async () => {
		await roomRconAction({ roomId: 9, action: "lock" });
		await roomRconAction({ roomId: 9, action: "unlock" });
		expect(state.rconSend).toHaveBeenCalledWith("updateroom", {
			room_id: 9,
			state: "locked",
		});
		expect(state.rconSend).toHaveBeenCalledWith("updateroom", {
			room_id: 9,
			state: "open",
		});
		expect(state.notify).not.toHaveBeenCalled();
	});

	it("performs no RCON or webhook call for an unknown action", async () => {
		await roomRconAction({ roomId: 9, action: "partywave" });
		expect(state.rconSend).not.toHaveBeenCalled();
		expect(state.notify).not.toHaveBeenCalled();
	});

	it("denies RCON actions without permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(roomRconAction({ roomId: 9, action: "kick" })).rejects.toThrow(
			"forbidden",
		);
	});

	it("deletes a room and notifies with its name", async () => {
		await deleteRoom({ id: 9 });
		expect(state.del).toHaveBeenCalledWith(Rooms, expect.anything());
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "room_delete",
				description: "Deleted room #9",
				targetId: 9,
			}),
		);
		expect(state.notify).toHaveBeenCalledWith({
			action: "room_delete",
			actor: "staff",
			target: "Lobby",
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms");
	});

	it("falls back to the numeric id for an unknown room on delete", async () => {
		state.roomRows = [];
		await deleteRoom({ id: 9 });
		expect(state.notify).toHaveBeenCalledWith(
			expect.objectContaining({ target: "#9" }),
		);
	});

	it("denies room deletion without the delete permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(deleteRoom({ id: 9 })).rejects.toThrow("forbidden");
		expect(state.del).not.toHaveBeenCalled();
	});

	it("updates room fields while discarding the id", async () => {
		await updateRoom({ id: 9, name: "New", usersMax: 50 });
		expect(state.requirePermission).toHaveBeenCalledWith("admin.room.edit");
		expect(state.update).toHaveBeenCalledWith(
			Rooms,
			{ name: "New", usersMax: 50 },
			expect.anything(),
		);
		expect(state.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "room_update",
				description: "Updated room #9",
				targetId: 9,
			}),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/rooms/9");
	});

	it("denies room updates without permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(updateRoom({ id: 9 })).rejects.toThrow("forbidden");
		expect(state.update).not.toHaveBeenCalled();
	});
});
