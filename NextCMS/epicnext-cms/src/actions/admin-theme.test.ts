// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockReload = vi.hoisted(() => vi.fn());
const mockLogStaffActivity = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() => vi.fn());
const mockSnapshotCurrentTheme = vi.hoisted(() => vi.fn());
const mockUpsertCustomTheme = vi.hoisted(() => vi.fn());
const mockGetCustomTheme = vi.hoisted(() => vi.fn());
const mockDeleteCustomThemeStore = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeActionDb } = await import("@/test/fake-db-actions");
	return { ...schema, db: createFakeActionDb(fakeDbConfig) };
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "admin.settings.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("next/navigation", () => ({
	redirect: mockRedirect,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: mockReload },
}));

vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

vi.mock("@/lib/theme-custom-store", () => ({
	snapshotCurrentTheme: mockSnapshotCurrentTheme,
	upsertCustomTheme: mockUpsertCustomTheme,
	getCustomTheme: mockGetCustomTheme,
	deleteCustomThemeStore: mockDeleteCustomThemeStore,
}));

import {
	applyCustomTheme,
	applyPreset,
	deleteCustomTheme,
	renameCustomTheme,
	saveCustomTheme,
	saveTheme,
} from "./admin-theme";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	mockRequirePermission.mockResolvedValue({
		id: 3,
		rank: 10,
		username: "owner",
	});
	mockSnapshotCurrentTheme.mockResolvedValue({ color_primary: "#ffffff" });
	mockUpsertCustomTheme.mockImplementation(
		(name: string, settings: object, id?: string) =>
			Promise.resolve({ id: id ?? "abc-123", name, settings }),
	);
	mockGetCustomTheme.mockResolvedValue(null);
	mockDeleteCustomThemeStore.mockResolvedValue(undefined);
});

describe("saveTheme", () => {
	it("writes valid theme settings for both modes and admin keys", async () => {
		await saveTheme(
			form({
				color_primary: "#123456",
				color_background: "purple!!!",
				color_primary_dark: "#654321",
				admin_canvas: "#111111",
				admin_text: "color!!!",
				border_radius: "16",
				font_family: "nunito",
				size_heading_h1: "30",
				size_heading_h2: "30px",
				custom_css: "body{color:red}",
			}),
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.settings.edit");
		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts).toHaveLength(7);
		const byKey = Object.fromEntries(
			inserts.map((op: any) => [op.values.key, op.values.value]),
		);
		expect(byKey).toEqual({
			color_primary: "#123456",
			color_primary_dark: "#654321",
			admin_canvas: "#111111",
			border_radius: "16",
			font_family: "nunito",
			size_heading_h1: "30",
			custom_css: "body{color:red}",
		});
		for (const op of inserts) {
			expect(op.table).toBeDefined();
			expect(op.onDuplicate).toBeDefined();
		}
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 3,
			action: "theme_update",
			description: "Updated theme settings",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?saved=1");
	});

	it("writes nothing when the form is empty but still reloads", async () => {
		await saveTheme(new FormData());
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?saved=1");
	});

	it("redirects with an error when a write fails", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await saveTheme(form({ color_primary: "#123456" }));
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});

describe("applyPreset", () => {
	it("writes every preset setting plus the preset name", async () => {
		await applyPreset(form({ preset: "Midnight" }));

		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts.length).toBeGreaterThan(0);
		const themePreset = inserts.find(
			(op: any) => op.values.key === "theme_preset",
		);
		expect(themePreset.values).toEqual({
			key: "theme_preset",
			value: "Midnight",
			comment: "Theme (housekeeping)",
		});
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "theme_preset",
				description: 'Applied theme preset "Midnight"',
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?preset=Midnight");
	});

	it("redirects back when the preset is unknown", async () => {
		await applyPreset(form({ preset: "NotARealPreset" }));
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme");
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
	});

	it("redirects with an error on write errors", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await applyPreset(form({ preset: "Ocean" }));
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});

describe("saveCustomTheme", () => {
	it("snapshots and persists the custom theme", async () => {
		await saveCustomTheme(form({ name: "My Theme" }));

		expect(mockSnapshotCurrentTheme).toHaveBeenCalledTimes(1);
		expect(mockUpsertCustomTheme).toHaveBeenCalledWith("My Theme", {
			color_primary: "#ffffff",
		});
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 3,
			action: "theme_preset",
			description: 'Saved custom theme "My Theme"',
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/theme");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?savedTheme=1");
	});

	it("redirects when the name is blank", async () => {
		mockRedirect.mockImplementationOnce(() => {
			throw new Error("NEXT_REDIRECT");
		});
		await expect(saveCustomTheme(form({ name: "  " }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockSnapshotCurrentTheme).not.toHaveBeenCalled();
	});

	it("redirects with an error on persist errors", async () => {
		mockUpsertCustomTheme.mockRejectedValueOnce(new Error("store down"));
		await saveCustomTheme(form({ name: "My Theme" }));
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});

describe("applyCustomTheme", () => {
	it("applies the saved theme settings", async () => {
		mockGetCustomTheme.mockResolvedValue({
			id: "t1",
			name: "Studio",
			createdAt: 0,
			settings: { color_primary: "#abcdef", color_error: "" },
		});
		await applyCustomTheme(form({ id: "t1" }));

		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts[0].values).toEqual({
			key: "color_primary",
			value: "#abcdef",
			comment: "Theme (housekeeping)",
		});
		const themePreset = inserts.find(
			(op: any) => op.values.key === "theme_preset",
		);
		expect(themePreset.values.value).toBe("Studio");
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'Applied custom theme "Studio"',
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?theme=Studio");
	});

	it("redirects when the id is blank", async () => {
		mockRedirect.mockImplementationOnce(() => {
			throw new Error("NEXT_REDIRECT");
		});
		await expect(applyCustomTheme(form({ id: "  " }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockGetCustomTheme).not.toHaveBeenCalled();
	});

	it("redirects when the theme is not found", async () => {
		mockRedirect.mockImplementationOnce(() => {
			throw new Error("NEXT_REDIRECT");
		});
		await expect(applyCustomTheme(form({ id: "nope" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockGetCustomTheme).toHaveBeenCalledWith("nope");
	});

	it("propagates a getCustomTheme failure", async () => {
		mockGetCustomTheme.mockRejectedValueOnce(new Error("read failed"));
		await expect(applyCustomTheme(form({ id: "t1" }))).rejects.toThrow(
			"read failed",
		);
	});

	it("redirects with an error on write errors", async () => {
		mockGetCustomTheme.mockResolvedValue({
			id: "t1",
			name: "Studio",
			createdAt: 0,
			settings: { color_primary: "#abcdef" },
		});
		fakeDbConfig.fail = (kind: string) => kind === "insert";
		await applyCustomTheme(form({ id: "t1" }));
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});

describe("renameCustomTheme", () => {
	it("renames a stored theme", async () => {
		await renameCustomTheme(form({ id: "t1", name: "Renamed" }));

		expect(mockSnapshotCurrentTheme).toHaveBeenCalledTimes(1);
		expect(mockUpsertCustomTheme).toHaveBeenCalledWith(
			"Renamed",
			{ color_primary: "#ffffff" },
			"t1",
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/theme");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?renamed=1");
	});

	it("redirects when id or name is missing", async () => {
		mockRedirect.mockImplementationOnce(() => {
			throw new Error("NEXT_REDIRECT");
		});
		await expect(renameCustomTheme(form({ id: "t1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockSnapshotCurrentTheme).not.toHaveBeenCalled();
	});

	it("redirects with an error on upsert errors", async () => {
		mockUpsertCustomTheme.mockRejectedValueOnce(new Error("store down"));
		await renameCustomTheme(form({ id: "t1", name: "Renamed" }));
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});

describe("deleteCustomTheme", () => {
	it("deletes the custom theme store entry", async () => {
		await deleteCustomTheme(form({ id: "t1" }));
		expect(mockDeleteCustomThemeStore).toHaveBeenCalledWith("t1");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/theme");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?deletedTheme=1");
	});

	it("redirects when the id is blank", async () => {
		mockRedirect.mockImplementationOnce(() => {
			throw new Error("NEXT_REDIRECT");
		});
		await expect(deleteCustomTheme(form({ id: "" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockDeleteCustomThemeStore).not.toHaveBeenCalled();
	});

	it("redirects with an error on store errors", async () => {
		mockDeleteCustomThemeStore.mockRejectedValueOnce(new Error("store down"));
		await deleteCustomTheme(form({ id: "t1" }));
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith("/admin/theme?error=1");
	});
});
