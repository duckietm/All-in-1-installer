import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	getAdminContext: async () => ({
		session: { user: { rank: 1 } },
		permissions: {},
	}),
	canAccess: mocks.access,
	PERMS: { DEVOPS_VIEW: "devops.view" },
}));
vi.mock("next/navigation", () => ({
	redirect: () => {
		throw Error("redirect");
	},
}));
vi.mock("@/lib/admin/installation", () => ({
	inspectInstallation: mocks.inspect,
}));
vi.mock("../../commandocentrum/refresh-status", () => ({
	RefreshStatus: () => null,
}));

import Page from "./page";

it("rejects unauthorized access before checking database, filesystem or worker", async () => {
	mocks.access.mockReturnValue(false);
	await expect(Page()).rejects.toThrow("redirect");
	expect(mocks.inspect).not.toHaveBeenCalled();
});
