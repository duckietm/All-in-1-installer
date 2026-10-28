import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	root: "",
	send: vi.fn(),
	log: vi.fn(() => "catalog-error-1"),
}));
vi.mock("@/lib/services/catalog-git-config", () => ({
	catalogStateRoot: () => state.root,
}));
vi.mock("@/lib/services/rcon", () => ({ rcon: { updateCatalog: state.send } }));
vi.mock("@/lib/logger", () => ({ logger: { error: state.log } }));

import {
	readCatalogHotelHistory,
	readCatalogHotelStatus,
	sendCatalogUpdate,
} from "./sync-status";

beforeEach(async () => {
	state.root = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-status-"));
	vi.clearAllMocks();
});
afterEach(async () => {
	await fs.rm(state.root, { recursive: true, force: true });
});
it("records a failed delivery without rejecting an already saved operation", async () => {
	state.send.mockResolvedValue(false);
	const result = await sendCatalogUpdate();
	expect(result.sent).toBe(false);
	expect(result.reference).toBe("catalog-error-1");
	expect(await readCatalogHotelStatus()).toEqual(result);
});
it("allows retrying the update without reapplying catalog mutations", async () => {
	state.send
		.mockRejectedValueOnce(Error("offline"))
		.mockResolvedValueOnce(true);
	expect((await sendCatalogUpdate()).sent).toBe(false);
	expect((await sendCatalogUpdate()).sent).toBe(true);
	expect((await readCatalogHotelStatus())?.sent).toBe(true);
});
it("returns no status before the first attempt", async () =>
	expect(await readCatalogHotelStatus()).toBeNull());

it("returns no history before the first attempt", async () =>
	expect(await readCatalogHotelHistory()).toEqual([]));

it("keeps earlier deliveries instead of overwriting them", async () => {
	state.send.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
	await sendCatalogUpdate();
	state.log.mockReturnValueOnce("catalog-error-2");
	await sendCatalogUpdate();

	const history = await readCatalogHotelHistory();
	expect(history.map((entry) => entry.sent)).toEqual([false, true]);
	expect(history[0].reference).toBe("catalog-error-2");
	// The snapshot is still the newest write, so the rail keeps showing it.
	expect((await readCatalogHotelStatus())?.sent).toBe(false);
});

it("survives a corrupt history file without blocking a delivery", async () => {
	state.send.mockResolvedValue(true);
	await fs.mkdir(state.root, { recursive: true });
	await fs.writeFile(
		path.join(state.root, "hotel-status-history.json"),
		"{not json",
	);

	await expect(sendCatalogUpdate()).resolves.toMatchObject({ sent: true });
	await expect(readCatalogHotelHistory()).resolves.toHaveLength(1);
});

it("drops the oldest entries past the retention limit", async () => {
	state.send.mockResolvedValue(true);
	for (let i = 0; i < 55; i++) await sendCatalogUpdate();

	expect(await readCatalogHotelHistory()).toHaveLength(50);
});
