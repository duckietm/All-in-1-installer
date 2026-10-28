// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	existing: vi.fn(),
	clone: vi.fn(),
	source: vi.fn(),
	import: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/db/schema")),
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: mocks.existing }) }),
		}),
	},
}));
vi.mock("./clone-import", () => ({ cloneSingleFurni: mocks.clone }));
vi.mock("./clone-sources", () => ({ getSource: mocks.source }));
vi.mock("./furni-import", () => ({ importSingleFurni: mocks.import }));

import { runSyncJobItem } from "./furni-sync-item";

const item = {
	id: 0,
	classname: "chair",
	name: "Chair",
	description: "",
	type: "flooritem",
	revision: 1,
	category: "other",
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.existing.mockResolvedValue([]);
	mocks.import.mockResolvedValue({ ok: true, warnings: [] });
});
it("skips an item another queued request has already imported", async () => {
	mocks.existing.mockResolvedValue([{ id: 3 }]);
	expect(await runSyncJobItem(item)).toMatchObject({ ok: true, itemId: 3 });
	expect(mocks.import).not.toHaveBeenCalled();
	expect(mocks.clone).not.toHaveBeenCalled();
});
it("never repairs existing furniture during official sync", async () => {
	await runSyncJobItem(item);
	expect(mocks.import).toHaveBeenCalledWith({ ...item, repairExisting: false });
});
it("fails a deleted clone source without substituting official assets", async () => {
	mocks.source.mockResolvedValue(null);
	await expect(
		runSyncJobItem({ ...item, cloneSourceId: "gone" }),
	).rejects.toThrow("no longer available");
	expect(mocks.import).not.toHaveBeenCalled();
});

it("returns the created clone item ID for audit correlation", async () => {
	mocks.existing.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 71 }]);
	mocks.source.mockResolvedValue({ id: "source" });
	mocks.clone.mockResolvedValue({ ok: true, warnings: [] });
	const cloneEntry = {
		id: 1,
		classname: "chair",
		name: "Chair",
		description: "",
		xdim: 1,
		ydim: 1,
		canstandon: false,
		cansiton: true,
		canlayon: false,
		customparams: "",
		itemType: "s" as const,
	};
	expect(
		await runSyncJobItem({ ...item, cloneSourceId: "source", cloneEntry }),
	).toMatchObject({ ok: true, itemId: 71 });
});
