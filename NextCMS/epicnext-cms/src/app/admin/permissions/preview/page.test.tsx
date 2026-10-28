import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ access: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(state.execute),
	db: { execute: state.execute },
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { PERMISSIONS_MANAGE: "admin.permissions.manage" },
	getAdminContext: async () => ({
		session: { user: { rank: 7 } },
		permissions: {},
	}),
	canAccess: state.access,
}));
vi.mock("next/navigation", () => ({
	redirect: () => {
		throw Error("redirect");
	},
}));
vi.mock("next-intl/server", () => ({
	getTranslations: async () => (key: string) => key,
}));
vi.mock("@/components/link", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<span>{children}</span>
	),
}));

import Page from "./page";

beforeEach(() => {
	state.access.mockReset().mockReturnValue(true);
	state.execute.mockReset();
});
it("rejects before querying role details", async () => {
	state.access.mockReturnValue(false);
	await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
		"redirect",
	);
	expect(state.execute).not.toHaveBeenCalled();
});
it("does not silently substitute an invalid requested role", async () => {
	state.execute.mockResolvedValueOnce([
		[{ id: 1, slug: "rank_1", title: "User" }],
	]);
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ role: "99" }) }),
	);
	expect(html).toContain("missing");
	expect(state.execute).toHaveBeenCalledTimes(1);
});
it("simulates highest-rank override from live rank data", async () => {
	state.execute
		.mockResolvedValueOnce([[{ id: 10, slug: "rank_8", title: "Owner" }]])
		.mockResolvedValueOnce([[]])
		.mockResolvedValueOnce([[{ highest_rank: 8 }]])
		.mockResolvedValueOnce([[]]);
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ role: "10" }) }),
	);
	expect(html).toContain("superAdmin");
	expect(html).toContain("entryAllowed");
});
it("does not infer owner privileges from a title", async () => {
	state.execute
		.mockResolvedValueOnce([[{ id: 10, slug: "owner", title: "Owner" }]])
		.mockResolvedValueOnce([[]])
		.mockResolvedValueOnce([[{ highest_rank: 8 }]])
		.mockResolvedValueOnce([[]]);
	const html = renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ role: "10" }) }),
	);
	expect(html).not.toContain("superAdmin");
	expect(html).toContain("entryDenied");
});
