// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { rcon } from "@/lib/services/rcon";
import { fakeForm } from "@/test/fake-form";
import { sendHotelAlert } from "./admin-alerts";

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { NOTIFICATIONS_EDIT: "notifications.edit" },
}));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
	},
	AlertLogs: {},
}));
vi.mock("@/lib/services/rcon", () => ({ rcon: { send: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue({
		id: 1,
		rank: 7,
		username: "admin",
	} as never);
});

describe("sendHotelAlert", () => {
	it("sends hotel alert and revalidates", async () => {
		await sendHotelAlert(fakeForm({ message: "Hello!" }) as FormData);
		expect(rcon.send).toHaveBeenCalledWith("hotelalert", { message: "Hello!" });
		expect(revalidatePath).toHaveBeenCalledWith("/admin/alerts");
	});

	it("returns early when message is empty", async () => {
		await sendHotelAlert(fakeForm({ message: "" }) as FormData);
		expect(rcon.send).not.toHaveBeenCalled();
	});
});
