// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const onDuplicateKeyUpdate = vi.fn(async () => [{}]);
	const insertValues = vi.fn(() => ({ onDuplicateKeyUpdate }));
	return {
		insertValues,
		onDuplicateKeyUpdate,
		requirePermission: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "admin.settings.edit" },
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			insert: vi.fn(() => ({ values: mocks.insertValues })),
		},
	};
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { PERMS } from "@/lib/permissions";
import { updateEmulatorSetting, updateEmulatorText } from "./admin-emulator";

function form(data: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(data)) f.set(k, v);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
	mocks.insertValues.mockReturnValue({
		onDuplicateKeyUpdate: mocks.onDuplicateKeyUpdate,
	});
	mocks.onDuplicateKeyUpdate.mockResolvedValue([{}]);
});

describe("updateEmulatorSetting", () => {
	it("upserts a setting and revalidates", async () => {
		await updateEmulatorSetting(
			form({ key: "  welcome_message  ", value: "Hi" }),
		);

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_EDIT);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "welcome_message",
			value: "Hi",
		});
		expect(mocks.onDuplicateKeyUpdate).toHaveBeenCalledWith({
			set: { value: "Hi" },
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/emulator");
	});

	it("returns early for a blank key", async () => {
		await updateEmulatorSetting(form({ key: "   ", value: "Hi" }));

		expect(mocks.insertValues).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("returns early when key and value fields are absent", async () => {
		await updateEmulatorSetting(new FormData());

		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("truncates the key to 100 and the value to 512 characters", async () => {
		await updateEmulatorSetting(
			form({ key: "k".repeat(120), value: "v".repeat(600) }),
		);

		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "k".repeat(100),
			value: "v".repeat(512),
		});
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		await expect(
			updateEmulatorSetting(form({ key: "a", value: "b" })),
		).rejects.toThrow("redirect:/admin");
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});

describe("updateEmulatorText", () => {
	it("upserts a text and revalidates", async () => {
		await updateEmulatorText(form({ key: "  text.key ", value: "Hello" }));

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_EDIT);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "text.key",
			value: "Hello",
		});
		expect(mocks.onDuplicateKeyUpdate).toHaveBeenCalledWith({
			set: { value: "Hello" },
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/emulator");
	});

	it("returns early for a blank key", async () => {
		await updateEmulatorText(form({ key: "", value: "Hello" }));

		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("returns early when key and value fields are absent", async () => {
		await updateEmulatorText(new FormData());

		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("truncates the value to 4096 characters", async () => {
		await updateEmulatorText(form({ key: "k", value: "v".repeat(5000) }));

		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "k",
			value: "v".repeat(4096),
		});
	});
});
