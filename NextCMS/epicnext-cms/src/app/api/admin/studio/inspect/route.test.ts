import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	read: vi.fn(),
	stat: vi.fn(),
	guard: vi.fn(),
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: unknown, handler: unknown) => {
		mocks.guard(options);
		return handler;
	},
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	db: { execute: mocks.execute },
}));
vi.mock("@/lib/services/furni-data", () => ({ readFurniData: mocks.read }));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: async () => ({
		nitroDir: "/assets/nitro",
		iconDir: "/assets/icons",
	}),
}));
vi.mock("node:fs", () => ({
	// `item-kind` offers both bundle names per classname; existence is still
	// decided by the mocked stat below.
	existsSync: () => false,
	promises: { stat: mocks.stat },
}));

import { emptyRouteContext } from "@/test/route-context";
import { POST } from "./route";

const request = (classnames: unknown) =>
	new NextRequest("http://localhost/api/admin/studio/inspect", {
		method: "POST",
		body: JSON.stringify({ classnames }),
	});
describe("furniture inspection", () => {
	beforeEach(() => {
		mocks.execute.mockReset().mockResolvedValue([[], []]);
		mocks.read.mockReset().mockResolvedValue({
			roomitemtypes: { furnitype: [] },
			wallitemtypes: { furnitype: [] },
		});
		mocks.stat.mockReset().mockRejectedValue({ code: "ENOENT" });
	});
	it("requires asset import permission", () => {
		expect(mocks.guard).toHaveBeenCalledWith({
			permission: expect.any(String),
		});
	});
	it("rejects path traversal before reading data", async () => {
		expect(
			(await POST(request(["../secret"]), emptyRouteContext())).status,
		).toBe(400);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.stat).not.toHaveBeenCalled();
	});
	it("uses local SQL IDs and color-aware asset filenames", async () => {
		mocks.execute
			.mockResolvedValueOnce([
				[
					{
						id: 90,
						spriteId: 91,
						classname: "chair*2",
						name: "Chair",
						type: "s",
					},
				],
				[],
			])
			.mockResolvedValueOnce([
				[{ classname: "chair*2", id: 5, pageId: 7, credits: 3, points: 0 }],
				[],
			]);
		const response = await POST(request(["chair*2"]), emptyRouteContext());
		const body = await response.json();
		expect(body.items[0].sql[0].id).toBe(90);
		expect(body.items[0].catalog[0].pageId).toBe(7);
		expect(
			mocks.stat.mock.calls.map((call) =>
				String(call[0]).replaceAll("\\", "/"),
			),
		).toEqual([
			// `.hab` is the live convention, so it is probed before the
			// legacy `.nitro` name for the same classname.
			"/assets/nitro/chair.hab",
			"/assets/nitro/chair.nitro",
			"/assets/icons/chair_2_icon.png",
		]);
	});
	it("distinguishes unreadable data and denied assets from missing files", async () => {
		mocks.read.mockRejectedValue(new Error("unreadable"));
		mocks.stat.mockRejectedValue({ code: "EACCES" });
		const body = await (
			await POST(request(["chair"]), emptyRouteContext())
		).json();
		expect(body.items[0].furnidataReadable).toBe(false);
		expect(body.items[0].icon.exists).toBeNull();
		expect(body.items[0].nitro.exists).toBeNull();
	});
	it("handles malformed furnidata without inventing a clean comparison", async () => {
		mocks.read.mockResolvedValue({
			roomitemtypes: { furnitype: {} },
			wallitemtypes: { furnitype: [null] },
		});
		const response = await POST(request(["chair"]), emptyRouteContext());
		expect(response.status).toBe(200);
		expect((await response.json()).items[0].furnidataReadable).toBe(false);
	});
	it("recognizes existing SQL and furnidata across classname casing", async () => {
		mocks.execute
			.mockResolvedValueOnce([
				[
					{
						id: 2000037258,
						spriteId: 2000037258,
						classname: "recycler_kintsugib",
						name: "Local",
						type: "s",
					},
				],
				[],
			])
			.mockResolvedValueOnce([
				[
					{
						id: 3,
						pageId: 4,
						classname: "RECYCLER_KINTSUGIB",
						credits: 3,
						points: 0,
					},
				],
				[],
			]);
		mocks.read.mockResolvedValue({
			roomitemtypes: {
				furnitype: [
					{ id: 2000037258, classname: "recycler_kintsugib", name: "Local" },
				],
			},
			wallitemtypes: { furnitype: [] },
		});
		mocks.stat.mockImplementation(async (filename) => {
			if (String(filename).includes("kintsugib"))
				return { size: 256, isFile: () => true };
			throw { code: "ENOENT" };
		});
		const result = await (
			await POST(request(["recycler_kintsugiB"]), emptyRouteContext())
		).json();
		expect(result.items[0].sql[0].id).toBe(2000037258);
		expect(result.items[0].catalog).toHaveLength(1);
		expect(result.items[0].furnidata).toHaveLength(1);
		expect(result.items[0].nitro.exists).toBe(true);
		expect(result.items[0].icon.exists).toBe(true);
	});
});
