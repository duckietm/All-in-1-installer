// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { fakeForm } from "@/test/fake-form";
import { disbandGuild } from "./admin-guilds";

const { selectLimit, transactionFn, deleteWhere, updateSet } = vi.hoisted(
	() => {
		const selectLimit = vi.fn();
		const transactionFn = vi.fn();
		const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
		const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
		return { selectLimit, transactionFn, deleteWhere, updateSet };
	},
);

vi.mock("@/lib/admin/guard", () => ({ requirePermissionRateLimited: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { USERS_EDIT: "users.edit" } }));
vi.mock("@/lib/db", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: selectLimit,
				})),
			})),
		})),
		transaction: transactionFn,
		delete: vi.fn(() => ({ where: deleteWhere })),
		update: vi.fn(() => ({ set: updateSet })),
	},
	Guilds: { id: "id", name: "name", userId: "userId" },
	GuildsForumsThreads: { id: "id", guildId: "guildId" },
	GuildsForumsComments: { threadId: "threadId" },
	GuildForumViews: { guildId: "guildId" },
	GuildsMembers: { guildId: "guildId" },
	Rooms: { guildId: "guildId" },
	Items: { guildId: "guildId" },
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermissionRateLimited).mockResolvedValue(staff as never);
});

describe("disbandGuild", () => {
	it("disbands guild and cleans related data", async () => {
		selectLimit.mockResolvedValue([{ id: 1, name: "TestGuild", userId: 42 }]);
		transactionFn.mockImplementation(
			async (fn: (tx: unknown) => Promise<void>) => {
				const txSelectLimit = vi.fn().mockResolvedValue([{ id: 10 }]);
				const tx = {
					select: vi.fn(() => ({
						from: vi.fn(() => ({
							where: vi.fn(() => ({
								limit: txSelectLimit,
							})),
						})),
					})),
					delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
					update: vi.fn(() => ({
						set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
					})),
				};
				// For threads findMany (no limit) — make where resolve to array
				tx.select = vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn().mockResolvedValue([{ id: 10 }]),
					})),
				}));
				await fn(tx);
			},
		);
		await disbandGuild(fakeForm({ id: "1" }) as FormData);
		expect(logStaffActivity).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/guilds");
	});

	it("returns early when id is not positive", async () => {
		await disbandGuild(fakeForm({ id: "0" }) as FormData);
		expect(selectLimit).not.toHaveBeenCalled();
	});
});
