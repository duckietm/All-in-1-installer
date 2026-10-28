// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	insertResult: [{ insertId: 1 }],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLogStaffActivity = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeActionDb } = await import("@/test/fake-db-actions");
	return { ...schema, db: createFakeActionDb(fakeDbConfig) };
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { RADIO_EDIT: "admin.radio.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

import { RadioAutoDjPlaylist } from "@/lib/db";
import { createTrack, deleteTrack, toggleTrack } from "./admin-radio-autodj";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	fakeDbConfig.insertResult = [{ insertId: 1 }];
	mockRequirePermission.mockResolvedValue({
		id: 99,
		rank: 7,
		username: "admin",
	});
});

describe("createTrack", () => {
	it("creates a track and logs staff activity", async () => {
		await createTrack(
			form({
				title: "Night Drive",
				artist: "Synthwave Kid",
				album: "Retro",
				artworkUrl: "https://cdn/x.png",
				duration: "95",
				sortOrder: "5.7",
				isActive: "on",
			}),
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.radio.edit");
		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(RadioAutoDjPlaylist);
		expect(op.values).toMatchObject({
			title: "Night Drive",
			artist: "Synthwave Kid",
			album: "Retro",
			artworkUrl: "https://cdn/x.png",
			duration: 95,
			sortOrder: 5,
			isActive: true,
		});
		expect(op.values.createdAt).toBeInstanceOf(Date);
		expect(op.values.updatedAt).toBeInstanceOf(Date);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 99,
			action: "radio_autodj_create",
			description: 'Created AutoDJ track "Night Drive" by Synthwave Kid',
			targetType: "radio_auto_dj_track",
			targetId: 1,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});

	it("rejects when the caller lacks RADIO_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(createTrack(form({ title: "x" }))).rejects.toThrow("denied");
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns early when title is blank", async () => {
		await createTrack(form({ title: "   " }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("stores blank optional fields as null and a byte-off isActive as false", async () => {
		await createTrack(form({ title: "Instrumental" }));

		expect(fakeDbConfig.ops[0].values).toMatchObject({
			artist: null,
			album: null,
			artworkUrl: null,
			duration: null,
			sortOrder: 0,
			isActive: false,
		});
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'Created AutoDJ track "Instrumental"',
				targetId: 1,
			}),
		);
	});

	it("treats invalid/negative numeric fields as 0/null", async () => {
		await createTrack(
			form({
				title: "Edge",
				duration: "-8",
				sortOrder: "-2",
			}),
		);
		expect(fakeDbConfig.ops[0].values).toMatchObject({
			title: "Edge",
			duration: null,
			sortOrder: 0,
			isActive: false,
		});
	});

	it("treats a NaN sortOrder/duration as 0/null", async () => {
		await createTrack(
			form({ title: "Edge2", duration: "abc", sortOrder: "abc" }),
		);
		expect(fakeDbConfig.ops[0].values).toMatchObject({
			duration: null,
			sortOrder: 0,
		});
	});

	it("swallows insert failures but still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await expect(
			createTrack(form({ title: "Track" })),
		).resolves.toBeUndefined();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});
});

describe("toggleTrack", () => {
	it("activates a track", async () => {
		await toggleTrack(form({ id: "7", isActive: "true" }));

		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(RadioAutoDjPlaylist);
		expect(op.set).toMatchObject({ isActive: true });
		expect(op.set.updatedAt).toBeInstanceOf(Date);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 99,
			action: "radio_autodj_toggle",
			description: "Activated AutoDJ track #7",
			targetType: "radio_auto_dj_track",
			targetId: 7,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});

	it("deactivates a track when isActive is 0", async () => {
		await toggleTrack(form({ id: "7", isActive: "0" }));
		expect(fakeDbConfig.ops[0].set).toMatchObject({ isActive: false });
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: "Deactivated AutoDJ track #7",
			}),
		);
	});

	it("returns early for a non-numeric id", async () => {
		await toggleTrack(form({ id: "nope" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("returns early for a zero id", async () => {
		await toggleTrack(form({ id: "0" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns early for a missing id", async () => {
		await toggleTrack(new FormData());
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("swallows update failures but still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await toggleTrack(form({ id: "2", isActive: "on" }));
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});
});

describe("deleteTrack", () => {
	it("deletes a track and logs staff activity", async () => {
		await deleteTrack(form({ id: "9" }));

		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(RadioAutoDjPlaylist);
		expect(op.where).toBeDefined();
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 99,
			action: "radio_autodj_delete",
			description: "Deleted AutoDJ track #9",
			targetType: "radio_auto_dj_track",
			targetId: 9,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});

	it("returns early for an invalid id", async () => {
		await deleteTrack(form({ id: "-3" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("swallows delete failures but still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteTrack(form({ id: "4" }));
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/autodj");
	});
});
