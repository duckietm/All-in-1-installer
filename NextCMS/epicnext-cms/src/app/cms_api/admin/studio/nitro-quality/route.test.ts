import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { createNitroBundle, encodePng } from "@/lib/services/swf/nitro-builder";

const mocks = vi.hoisted(() => ({ read: vi.fn(), guard: vi.fn() }));
// `bundle-file` resolves the live bundle (`.hab`, else legacy `.nitro`)
// through existsSync before the route reads it.
vi.mock("node:fs", () => ({
	existsSync: () => true,
	promises: { readFile: mocks.read },
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: unknown, handler: unknown) => {
		mocks.guard(options);
		return handler;
	},
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: async () => ({ nitroDir: "/nitro" }),
}));

import { emptyRouteContext } from "@/test/route-context";
import { GET } from "./route";

const request = (query: string) =>
	new NextRequest(`http://localhost/cms_api/admin/studio/nitro-quality?${query}`);
beforeEach(() => {
	mocks.read.mockReset().mockResolvedValue(
		createNitroBundle(
			{
				assets: { chair_32_a_0_0: {} },
				visualizations: [{ size: 32 }],
				spritesheet: {
					frames: { chair_32_a_0_0: { frame: { x: 0, y: 0, w: 2, h: 3 } } },
				},
			},
			encodePng(4, 4, Buffer.alloc(64, 255)),
			"chair",
		),
	);
});
it("requires import permission", () =>
	expect(mocks.guard).toHaveBeenCalledWith({
		permission: PERMS.ASSETS_IMPORT,
	}));
it("rejects path traversal before reading disk", async () => {
	expect(
		(await GET(request("classname=../secret"), emptyRouteContext())).status,
	).toBe(400);
	expect(mocks.read).not.toHaveBeenCalled();
});
it("reports both scales from the actual bundle", async () => {
	const response = await GET(request("classname=chair"), emptyRouteContext());
	expect(
		(await response.json()).report.scales.map(
			(s: { state: string }) => s.state,
		),
	).toEqual(["present", "missing"]);
});
it("extracts the actual sprite dimensions without resizing", async () => {
	const response = await GET(
		request("classname=chair&asset=chair_32_a_0_0"),
		emptyRouteContext(),
	);
	expect(response.status).toBe(200);
	const meta = await sharp(
		Buffer.from(await response.arrayBuffer()),
	).metadata();
	expect([meta.width, meta.height]).toEqual([2, 3]);
});
it("rejects an unknown sprite instead of returning a different one", async () => {
	expect(
		(await GET(request("classname=chair&asset=other"), emptyRouteContext()))
			.status,
	).toBe(404);
});
