// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sources: vi.fn(),
	validate: vi.fn((buffer: Buffer) => buffer),
}));
vi.mock("./clone-sources", () => ({ listSources: mocks.sources }));
vi.mock("./furni-attachment", () => ({
	validateFurnitureAttachment: mocks.validate,
}));

import { recoverFurnitureNitro } from "./furniture-source-recovery";

const item = { classname: "chair", type: "flooritem", revision: 42 };
const source = (id: string) => ({
	id,
	name: id,
	furnidataUrl: `https://${id}.test/data`,
	nitroBaseUrl: `https://${id}.test/nitro`,
});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.validate.mockImplementation((buffer) => buffer);
});
it("skips the selected and disabled sources and rejects a different type or revision", async () => {
	mocks.sources.mockResolvedValue([
		source("selected"),
		{ ...source("disabled"), enabled: false },
		source("wrong"),
		source("matching"),
	]);
	const fetcher = vi.fn(async (url: string) =>
		url.endsWith("/data")
			? Response.json({
					roomitemtypes: {
						furnitype: [
							{ classname: "chair", revision: url.includes("wrong") ? 41 : 42 },
						],
					},
				})
			: new Response("bundle"),
	);
	vi.stubGlobal("fetch", fetcher);
	const result = await recoverFurnitureNitro(item, {
		excludeSourceId: "selected",
	});
	expect(result?.sourceId).toBe("matching");
	expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
		"https://wrong.test/data",
		"https://matching.test/data",
		"https://matching.test/nitro/chair.nitro",
	]);
	expect(mocks.validate).toHaveBeenCalledWith(Buffer.from("bundle"), "chair");
});
it("rejects bundles with the wrong identity without writing them", async () => {
	mocks.sources.mockResolvedValue([source("badbundle")]);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url.endsWith("/data")
				? Response.json({
						roomitemtypes: {
							furnitype: [{ classname: "chair", revision: 42 }],
						},
					})
				: new Response("other furniture"),
		),
	);
	mocks.validate.mockImplementation(() => {
		throw Error("Wrong identity");
	});
	expect(await recoverFurnitureNitro(item)).toBeNull();
});
it("does not download a floor bundle for a wall item or a similar classname", async () => {
	mocks.sources.mockResolvedValue([source("floor")]);
	const fetcher = vi.fn(async () =>
		Response.json({
			roomitemtypes: { furnitype: [{ classname: "chair", revision: 42 }] },
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	expect(await recoverFurnitureNitro({ ...item, type: "wallitem" })).toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects excessive content-length before buffering the bundle", async () => {
	mocks.sources.mockResolvedValue([source("oversize")]);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url.endsWith("/data")
				? Response.json({
						roomitemtypes: {
							furnitype: [{ classname: "chair", revision: 42 }],
						},
					})
				: new Response("huge", { headers: { "content-length": "1000000000" } }),
		),
	);
	expect(await recoverFurnitureNitro(item)).toBeNull();
	expect(mocks.validate).not.toHaveBeenCalled();
});
