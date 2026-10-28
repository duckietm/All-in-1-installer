import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions", () => import("@/lib/permission-slugs"));
const search = vi.hoisted(() => vi.fn());
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/features/catalog/server/search", () => ({ searchCatalog: search }));
vi.mock("@/features/catalog/server/errors", () => ({
	catalogFailure: () => ({ message: "Invalid search", status: 400 }),
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (
		options: unknown,
		handler: (request: NextRequest) => Promise<Response>,
	) => {
		guard(options);
		return handler;
	},
}));

import { PERMS } from "@/lib/permissions";
import { emptyRouteContext } from "@/test/route-context";
import { GET } from "./route";

beforeEach(() => {
	search.mockReset();
});
describe("catalog search route", () => {
	it("registers the catalog read permission", () => {
		expect(guard).toHaveBeenCalledWith({ permission: PERMS.CATALOG_VIEW });
	});
	it("forwards normal or BC without widening scope and returns results", async () => {
		search.mockResolvedValue([]);
		const response = await GET(
			new NextRequest(
				"https://cms.test/api/admin/catalog/search?catalog=bc&q=chair",
			),
			emptyRouteContext(),
		);
		expect(search).toHaveBeenCalledWith("bc", "chair");
		expect(await response.json()).toEqual({ ok: true, results: [] });
	});
	it("returns a validation error without a success payload", async () => {
		search.mockRejectedValue(Error("Invalid search"));
		const response = await GET(
			new NextRequest("https://cms.test/api/admin/catalog/search?q=a"),
			emptyRouteContext(),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid search" });
	});
});
