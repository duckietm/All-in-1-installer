// @ts-nocheck
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { fakeForm } from "@/test/fake-form";
import { applyStaff, applyTeam } from "./applications";

const { selectLimit, insertValues } = vi.hoisted(() => {
	const selectLimit = vi.fn();
	const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
	return { selectLimit, insertValues };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: selectLimit,
				})),
			})),
		})),
		insert: vi.fn(() => ({ values: insertValues })),
	},
	WebsiteStaffApplications: {
		id: "id",
		userId: "userId",
		rankId: "rankId",
	},
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: vi.fn(), rateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth).mockResolvedValue({ user: { id: "42" } });
	vi.mocked(clientIp).mockResolvedValue("127.0.0.1");
	vi.mocked(rateLimit).mockResolvedValue({ ok: true });
	selectLimit.mockResolvedValue([]);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
});

describe("applyStaff", () => {
	it("submits staff application", async () => {
		await applyStaff(
			fakeForm({
				rankId: "3",
				content: "I want to help!",
			}),
		);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 42,
				rankId: 3,
				content: "I want to help!",
			}),
		);
		expect(redirect).toHaveBeenCalledWith("/apply/staff?submitted=1");
	});

	it("redirects to login when not authenticated", async () => {
		vi.mocked(auth).mockResolvedValue(null);
		await applyStaff(fakeForm({}));
		expect(redirect).toHaveBeenCalledWith("/login");
	});

	it("returns duplicate status when application exists", async () => {
		selectLimit.mockResolvedValue([{ id: 1 }]);
		await applyStaff(
			fakeForm({
				rankId: "3",
				content: "I want to help!",
			}),
		);
		expect(insertValues).not.toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/apply/staff?error=duplicate");
	});

	it("handles rate limit", async () => {
		vi.mocked(rateLimit).mockResolvedValue({ ok: false });
		await applyStaff(
			fakeForm({
				rankId: "3",
				content: "I want to help!",
			}),
		);
		expect(redirect).toHaveBeenCalledWith("/apply/staff?error=ratelimit");
	});
});

describe("applyTeam", () => {
	it("submits team application", async () => {
		await applyTeam(
			fakeForm({
				teamId: "2",
				content: "I want to join team!",
			}),
		);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 42,
				rankId: 2,
				content: "I want to join team!",
			}),
		);
		expect(redirect).toHaveBeenCalledWith("/apply/team?submitted=1");
	});

	it("redirects to login when not authenticated", async () => {
		vi.mocked(auth).mockResolvedValue(null);
		await applyTeam(fakeForm({}));
		expect(redirect).toHaveBeenCalledWith("/login");
	});
});
