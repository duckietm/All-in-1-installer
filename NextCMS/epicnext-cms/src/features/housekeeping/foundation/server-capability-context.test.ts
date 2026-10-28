import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getAdminContext, staleActor } = vi.hoisted(() => ({
	auth: vi.fn(),
	getAdminContext: vi.fn(),
	staleActor: { id: 9, username: "stale-session", rank: 1 },
}));

vi.mock("react", () => ({
	cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => {
	throw new Error("server capability context must not access the database");
});
vi.mock("@/lib/permissions", () => ({ getAdminContext }));

import { auth as mockedAuth } from "@/lib/auth";
import { getHousekeepingCapabilityContext } from "./server-capability-context";

describe("getHousekeepingCapabilityContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		auth.mockResolvedValue({ user: staleActor });
		getAdminContext.mockResolvedValue({
			session: {
				user: {
					id: 42,
					username: "operator",
					rank: 7,
				},
			},
			permissions: {
				isSuperAdmin: false,
				has: (slug: string) => slug === "admin.users.view",
				hasAny: (...slugs: string[]) => slugs.includes("admin.users.view"),
				hasAll: (...slugs: string[]) =>
					slugs.every((slug) => slug === "admin.users.view"),
			},
		});
	});

	it("uses the refreshed administrator actor instead of the stale auth actor", async () => {
		const context = await getHousekeepingCapabilityContext();

		expect(context).toMatchObject({
			actor: { id: 42, username: "operator", rank: 7 },
			isSuperAdmin: false,
		});
		expect(context.has("admin.users.view")).toBe(true);
		expect(context.has("admin.logs.view")).toBe(false);
		expect(getAdminContext).toHaveBeenCalledTimes(1);
		expect(mockedAuth).not.toHaveBeenCalled();
	});
});
