// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), import: vi.fn() }));
vi.mock("./furniture-inspection", () => ({ inspectFurniture: mocks.inspect }));
vi.mock("./furni-import", () => ({ importSingleFurni: mocks.import }));

import { repairFurniture } from "./furniture-repair";

const complete: FurnitureInspection = {
	classname: "chair",
	sql: [{ id: 9, spriteId: 10, name: "Local name", type: "s" }],
	furnidata: [
		{
			id: 10,
			name: "Local name",
			description: "Keep",
			revision: 1,
			type: "flooritem",
		},
	],
	furnidataReadable: true,
	catalog: [{ id: 2, pageId: 3, credits: 5, points: 0 }],
	nitro: { exists: true, bytes: 200 },
	icon: { exists: true, bytes: 100 },
};
const params = {
	classname: "chair",
	id: 50,
	name: "Source name",
	description: "Source",
	type: "flooritem",
	revision: 2,
	category: "other",
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.import.mockResolvedValue({ ok: true, itemId: 9, warnings: [] });
});
it("does nothing for complete furniture", async () => {
	mocks.inspect.mockResolvedValue([complete]);
	expect((await repairFurniture(params)).ok).toBe(true);
	expect(mocks.import).not.toHaveBeenCalled();
});
it("preserves local IDs, existing furnidata and assets and verifies afterward", async () => {
	mocks.inspect
		.mockResolvedValueOnce([{ ...complete, icon: { exists: false, bytes: 0 } }])
		.mockResolvedValueOnce([complete]);
	expect((await repairFurniture(params)).ok).toBe(true);
	expect(mocks.import).toHaveBeenCalledWith(
		expect.objectContaining({
			id: 10,
			repairExisting: true,
			preserveAssets: true,
			skipFurniDataWrite: true,
		}),
	);
	expect(mocks.inspect).toHaveBeenCalledTimes(2);
});
it("does not report success when a component is still missing", async () => {
	mocks.inspect.mockResolvedValue([
		{ ...complete, icon: { exists: false, bytes: 0 } },
	]);
	expect(await repairFurniture(params)).toMatchObject({
		ok: false,
		error: "Repair incomplete. Still missing: Icon",
	});
});
it("blocks conflicting and unreadable local data before mutation", async () => {
	mocks.inspect.mockResolvedValue([{ ...complete, furnidataReadable: false }]);
	await expect(repairFurniture(params)).rejects.toThrow("blocked");
	expect(mocks.import).not.toHaveBeenCalled();
});
