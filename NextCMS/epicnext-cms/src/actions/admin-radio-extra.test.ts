// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	insertResult: [{ insertId: 1 }],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockReload = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

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

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: mockReload },
}));

vi.mock("@/lib/logger", () => ({
	logger: {
		error: mockLoggerError,
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

import { RadioBanners, RadioRanks, WebsiteSetting } from "@/lib/db";
import {
	createRadioBanner,
	createRadioRank,
	deleteRadioBanner,
	deleteRadioRank,
	saveRadioSetting,
	saveRadioSettings,
	updateRadioBanner,
	updateRadioRank,
} from "./admin-radio-extra";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

const staff = { id: 99, rank: 7, username: "admin" };

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	fakeDbConfig.insertResult = [{ insertId: 1 }];
	mockRequirePermission.mockResolvedValue(staff);
});

describe("saveRadioSetting", () => {
	it("upserts a radio_* setting and reloads the settings cache", async () => {
		await saveRadioSetting(
			form({
				key: " radio_stream_url ",
				value: " https://stream.example/radio ",
				comment: "Main stream",
			}),
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.radio.edit");
		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteSetting);
		expect(op.values).toEqual({
			key: "radio_stream_url",
			value: " https://stream.example/radio ",
			comment: "Main stream",
		});
		expect(op.onDuplicate).toEqual({ value: " https://stream.example/radio " });
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/settings");
	});

	it("stores a null comment when blank", async () => {
		await saveRadioSetting(form({ key: "radio_name", value: "Atom FM" }));
		expect(fakeDbConfig.ops[0].values).toEqual({
			key: "radio_name",
			value: "Atom FM",
			comment: null,
		});
	});

	it("returns early when the key is blank", async () => {
		await saveRadioSetting(form({ key: "   ", value: "x" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("logs and continues on DB failure", async () => {
		fakeDbConfig.fail = (kind: string) => (kind === "insert" ? "boom" : false);
		await saveRadioSetting(form({ key: "radio_name", value: "Atom FM" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to save radio setting",
			{ err: expect.any(Error), key: "radio_name" },
		);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/settings");
	});
});

describe("saveRadioSettings", () => {
	it("bulk upserts only radio_/auto_dj_ keys and reloads", async () => {
		await saveRadioSettings(
			form({
				__keys: "radio_foo, auto_dj_bar, unrelated, radio_baz ",
				radio_foo: "1",
				auto_dj_bar: "green",
				unrelated: "nope",
				radio_baz: "0",
			}),
		);

		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts).toHaveLength(3);
		expect(inserts.map((o: any) => o.values.key).sort()).toEqual([
			"auto_dj_bar",
			"radio_baz",
			"radio_foo",
		]);
		for (const op of inserts) {
			expect(op.values.comment).toBeNull();
			expect(op.onDuplicate).toBeDefined();
		}
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/settings");
	});

	it("returns early without touching the DB when no keys match", async () => {
		await saveRadioSettings(form({ __keys: "other_x, extra" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("logs and continues when the bulk upsert fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await saveRadioSettings(form({ __keys: "radio_foo", radio_foo: "1" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to bulk-save radio settings",
			expect.objectContaining({ err: expect.any(Error), keys: ["radio_foo"] }),
		);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/settings");
	});
});

describe("createRadioBanner", () => {
	it("creates a banner owned by the staff user", async () => {
		await createRadioBanner(
			form({
				imagePath: "/banners/a.png",
				title: "Summer",
				description: "Beach party",
				sortOrder: "5.9",
				isActive: "on",
			}),
		);

		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(RadioBanners);
		expect(op.values).toMatchObject({
			userId: 99n,
			imagePath: "/banners/a.png",
			title: "Summer",
			description: "Beach party",
			sortOrder: 5,
			isActive: true,
		});
		expect(op.values.createdAt).toBeInstanceOf(Date);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});

	it("returns early without an image path", async () => {
		await createRadioBanner(form({ title: "No image" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("strips blank optional fields and coerces invalid sortOrder to 0", async () => {
		await createRadioBanner(
			form({ imagePath: "/banners/b.png", sortOrder: "xyz", isActive: "0" }),
		);
		expect(fakeDbConfig.ops[0].values).toMatchObject({
			title: null,
			description: null,
			sortOrder: 0,
			isActive: false,
		});
	});

	it("logs and continues when the insert fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await createRadioBanner(form({ imagePath: "/banners/c.png" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to create radio banner",
			{ err: expect.any(Error), imagePath: "/banners/c.png" },
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});
});

describe("updateRadioBanner", () => {
	it("updates an existing banner", async () => {
		await updateRadioBanner(
			form({
				id: "3",
				imagePath: "/banners/next.png",
				title: "Winter",
				description: "Snow",
				sortOrder: "1",
				isActive: "true",
			}),
		);

		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(RadioBanners);
		expect(op.set).toMatchObject({
			imagePath: "/banners/next.png",
			title: "Winter",
			description: "Snow",
			sortOrder: 1,
			isActive: true,
		});
		expect(op.set.updatedAt).toBeInstanceOf(Date);
		expect(op.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});

	it("returns early for an invalid id", async () => {
		await updateRadioBanner(form({ id: "xyz", imagePath: "/banners/x.png" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns early when the image path is blank", async () => {
		await updateRadioBanner(form({ id: "3", imagePath: "   " }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("logs and continues on update failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await updateRadioBanner(form({ id: "3", imagePath: "/banners/x.png" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to update radio banner",
			expect.objectContaining({ err: expect.any(Error) }),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});
});

describe("deleteRadioBanner", () => {
	it("deletes a banner by id", async () => {
		await deleteRadioBanner(form({ id: "5" }));
		const del = fakeDbConfig.ops[0];
		expect(del.kind).toBe("delete");
		expect(del.table).toBe(RadioBanners);
		expect(del.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});

	it("returns early for an invalid id", async () => {
		await deleteRadioBanner(form({ id: "0" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("logs and continues on delete failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteRadioBanner(form({ id: "6" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to delete radio banner",
			expect.objectContaining({ err: expect.any(Error) }),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/banners");
	});
});

describe("createRadioRank", () => {
	it("creates a rank", async () => {
		await createRadioRank(
			form({
				name: "DJ Legend",
				description: "Top DJ",
				badgeCode: "DJ01",
				isActive: "1",
			}),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(RadioRanks);
		expect(op.values).toMatchObject({
			name: "DJ Legend",
			description: "Top DJ",
			badgeCode: "DJ01",
			isActive: true,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});

	it("returns early without a name", async () => {
		await createRadioRank(form({ badgeCode: "X" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("stores nulls for blank optional fields", async () => {
		await createRadioRank(form({ name: "Listener" }));
		expect(fakeDbConfig.ops[0].values).toMatchObject({
			description: null,
			badgeCode: null,
			isActive: false,
		});
	});

	it("logs and continues on insert failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await createRadioRank(form({ name: "Broken" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to create radio rank",
			{ err: expect.any(Error), name: "Broken" },
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});
});

describe("updateRadioRank", () => {
	it("updates an existing rank", async () => {
		await updateRadioRank(
			form({
				id: "2",
				name: "VIP",
				description: "Premium",
				badgeCode: "VIP02",
				isActive: "on",
			}),
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("update");
		expect(op.table).toBe(RadioRanks);
		expect(op.set).toMatchObject({
			name: "VIP",
			description: "Premium",
			badgeCode: "VIP02",
			isActive: true,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});

	it("returns early for an invalid id", async () => {
		await updateRadioRank(form({ id: "abc", name: "VIP" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("returns early when the name is blank", async () => {
		await updateRadioRank(form({ id: "2", name: "  " }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("logs and continues on update failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "update";
		await updateRadioRank(form({ id: "2", name: "VIP" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to update radio rank",
			expect.objectContaining({ err: expect.any(Error) }),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});
});

describe("deleteRadioRank", () => {
	it("deletes a rank by id", async () => {
		await deleteRadioRank(form({ id: "4" }));
		const del = fakeDbConfig.ops[0];
		expect(del.kind).toBe("delete");
		expect(del.table).toBe(RadioRanks);
		expect(del.where).toBeDefined();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});

	it("returns early for an invalid id", async () => {
		await deleteRadioRank(form({ id: "-1" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("logs and continues on delete failure", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteRadioRank(form({ id: "7" }));
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Failed to delete radio rank",
			expect.objectContaining({ err: expect.any(Error) }),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/ranks");
	});
});
