import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";

const mocks = vi.hoisted(() => ({
	guard: vi.fn(),
	source: vi.fn(),
	official: vi.fn(),
	inspect: vi.fn(),
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: unknown, handler: unknown) => {
		mocks.guard(options);
		return handler;
	},
}));
vi.mock("@/lib/services/clone-sources", () => ({ getSource: mocks.source }));
vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	getOfficialHabboFurnidata: mocks.official,
}));
vi.mock("@/lib/services/furniture-source-assets", () => ({
	inspectSourceAssets: mocks.inspect,
}));

import { emptyRouteContext } from "@/test/route-context";
import { POST } from "./route";

const item = {
	id: 1,
	classname: "chair",
	name: "Chair",
	description: "",
	revision: 1,
	type: "flooritem",
	category: "other",
};
const request = (body: unknown) =>
	new NextRequest("http://localhost/cms_api/admin/studio/source-assets", {
		method: "POST",
		body: JSON.stringify(body),
	});
beforeEach(() => {
	mocks.source.mockReset().mockResolvedValue(null);
	mocks.official.mockReset().mockResolvedValue(new Map());
	mocks.inspect.mockReset().mockResolvedValue({
		classname: "chair",
		state: "missing",
		revision: 1,
		alternatives: [],
	});
});
it("requires import permission", () =>
	expect(mocks.guard).toHaveBeenCalledWith({
		permission: PERMS.ASSETS_IMPORT,
	}));
it.each([
	[],
	Array(21).fill(item),
	[{ ...item, classname: "../secret" }],
	[{ ...item, revision: -1 }],
	[null],
])("rejects invalid items before network checks: %j", async (items) => {
	expect((await POST(request({ items }), emptyRouteContext())).status).toBe(
		400,
	);
	expect(mocks.inspect).not.toHaveBeenCalled();
});
it("rejects unknown configured sources", async () => {
	expect(
		(
			await POST(
				request({ items: [item], sourceId: "missing" }),
				emptyRouteContext(),
			)
		).status,
	).toBe(404);
	expect(mocks.inspect).not.toHaveBeenCalled();
});
it("uses server source configuration instead of client URLs", async () => {
	const source = { id: "custom", nitroBaseUrl: "https://configured.example" };
	mocks.source.mockResolvedValue(source);
	const response = await POST(
		request({
			items: [item],
			sourceId: "custom",
			nitroBaseUrl: "https://untrusted.example",
		}),
		emptyRouteContext(),
	);
	expect(response.status).toBe(200);
	expect(mocks.inspect).toHaveBeenCalledWith(item, [], source);
	expect((await response.json()).items[0].state).toBe("missing");
});
