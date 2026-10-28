// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	create: vi.fn(),
	official: vi.fn(),
	sources: vi.fn(),
	fetch: vi.fn(),
	ping: vi.fn(),
	drain: vi.fn(),
	after: vi.fn(),
	existing: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after, NextResponse: Response }));
vi.mock("@/lib/db", () => ({
	ItemsBase: { itemName: "item_name" },
	db: { select: () => ({ from: mocks.existing }) },
}));
vi.mock("@/lib/redis", () => ({ redis: { ping: mocks.ping } }));
vi.mock("./furni-job-store", () => ({
	validJobId: (id: unknown) => typeof id === "string" && id.length === 36,
	ImportJobStore: class {
		read = mocks.read;
		create = mocks.create;
	},
}));
vi.mock("./furni-job-worker", () => ({ drainFurnitureImports: mocks.drain }));
vi.mock("./clone-sources", () => ({ listSources: mocks.sources }));
vi.mock("./clone-import", () => ({ fetchSourceFurnidata: mocks.fetch }));
vi.mock("./habbo-furnidata-cache", () => ({
	getOfficialHabboFurnidata: mocks.official,
}));

import { enqueueFurnitureSync } from "./furni-sync-queue";

const id = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown = { id }) =>
	new Request("https://example.test/api/sync", {
		method: "POST",
		body: JSON.stringify(body),
	});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.read.mockRejectedValue({ code: "ENOENT" });
	mocks.create.mockImplementation(async (job) => job);
	mocks.ping.mockResolvedValue("PONG");
	mocks.existing.mockResolvedValue([]);
	mocks.official.mockResolvedValue(new Map());
	mocks.sources.mockResolvedValue([]);
});
describe("durable synchronization enqueue", () => {
	it("persists an empty completed job when already up to date", async () => {
		const res = await enqueueFurnitureSync(request(), 7, "official");
		expect(res.status).toBe(200);
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({ state: "completed", items: [], userId: 7 }),
		);
	});
	it("reuses an existing request before source discovery", async () => {
		const job = { id, userId: 7, syncKind: "official" };
		mocks.read.mockResolvedValue(job);
		expect((await enqueueFurnitureSync(request(), 7, "official")).status).toBe(
			200,
		);
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.official).not.toHaveBeenCalled();
	});
	it("rejects other owners and changed operation kinds", async () => {
		mocks.read.mockResolvedValue({ id, userId: 8, syncKind: "official" });
		expect((await enqueueFurnitureSync(request(), 7, "official")).status).toBe(
			409,
		);
		mocks.read.mockResolvedValue({ id, userId: 7, syncKind: "clone" });
		expect((await enqueueFurnitureSync(request(), 7, "official")).status).toBe(
			409,
		);
	});
	it("does not enqueue while redis is unavailable", async () => {
		mocks.ping.mockRejectedValue(Error("offline"));
		expect((await enqueueFurnitureSync(request(), 7, "official")).status).toBe(
			503,
		);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("deduplicates classnames across source snapshots", async () => {
		mocks.sources.mockResolvedValue([
			{ id: "a", furnidataUrl: "a" },
			{ id: "b", furnidataUrl: "b" },
		]);
		mocks.fetch.mockResolvedValue([
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				itemType: "s",
			},
		]);
		await enqueueFurnitureSync(request(), 7, "clone");
		const job = mocks.create.mock.calls[0][0];
		expect(job.items).toHaveLength(1);
		expect(job.items[0].cloneSourceId).toBe("a");
		expect(job.items[0].cloneEntry.classname).toBe("chair");
	});
	it("never queues partial discovery after a source failure", async () => {
		mocks.sources.mockResolvedValue([{ id: "a", furnidataUrl: "a" }]);
		mocks.fetch.mockRejectedValue(Error("unavailable"));
		await expect(enqueueFurnitureSync(request(), 7, "clone")).rejects.toThrow(
			"unavailable",
		);
		expect(mocks.create).not.toHaveBeenCalled();
	});
});
