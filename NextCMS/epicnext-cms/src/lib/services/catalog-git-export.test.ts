// @ts-nocheck
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), publish: vi.fn() }));
vi.mock("./catalog-git-snapshot", () => ({
	createCatalogSnapshot: mocks.snapshot,
}));
vi.mock("./catalog-git-core", async (original) => ({
	...(await original<typeof import("./catalog-git-core")>()),
	publishCatalogFiles: mocks.publish,
}));

import { runCatalogExport } from "./catalog-git-export";
import { catalogExportQueue, withCatalogExport } from "./catalog-git-queue";

describe("export worker", () => {
	beforeEach(async () => {
		vi.stubEnv("CATALOG_GIT_CHECKOUT", "/configured/checkout");
		vi.stubEnv(
			"CATALOG_GIT_STATE_DIR",
			await mkdtemp(path.join(os.tmpdir(), "catalog-worker-")),
		);
		mocks.snapshot.mockReset().mockResolvedValue([]);
		mocks.publish.mockReset().mockResolvedValue("abc123");
	});
	afterEach(() => vi.unstubAllEnvs());
	it("retains failed work, retries it and clears only completed events", async () => {
		const q = catalogExportQueue();
		await q.request();
		mocks.publish.mockRejectedValueOnce(new Error("credential secret"));
		await runCatalogExport();
		expect(await q.batch()).toHaveLength(1);
		expect(
			await readFile(path.join(q.root, "status.json"), "utf8"),
		).not.toContain("credential secret");
		await runCatalogExport();
		expect(await q.batch()).toHaveLength(0);
		expect(mocks.publish).toHaveBeenCalledTimes(2);
	});
	it("does not publish during an operation or if one starts while capturing", async () => {
		const q = catalogExportQueue();
		await q.request();
		await withCatalogExport(async () => {
			await runCatalogExport();
		});
		expect(mocks.snapshot).not.toHaveBeenCalled();
		mocks.snapshot.mockImplementationOnce(async () => {
			await q.request();
			return [];
		});
		await runCatalogExport();
		expect(mocks.publish).not.toHaveBeenCalled();
		expect(await q.batch()).toHaveLength(3);
	});
});
