// @ts-nocheck
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	CatalogExportQueue,
	recoverCatalogQueue,
	sqlValue,
} from "./catalog-git-core";

describe("catalog export", () => {
	it("recovers queue entries owned by a terminated local process", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "catalog-recovery-"));
		const deadPid = Number(
			execFileSync(
				process.execPath,
				["-e", "process.stdout.write(String(process.pid))"],
				{ encoding: "utf8" },
			),
		);
		const owner = JSON.stringify({ pid: deadPid, host: os.hostname() });
		await writeFile(path.join(root, "12345678.active"), owner);
		await writeFile(path.join(root, "worker.lock"), owner);
		await recoverCatalogQueue(root);
		const q = new CatalogExportQueue(root);
		expect(await q.batch()).toEqual(["12345678.pending"]);
		expect(await q.entries()).not.toContain("worker.lock");
	});

	it("keeps new requests pending when an older snapshot completes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "catalog-queue-"));
		const q = new CatalogExportQueue(root);
		const finish = await q.begin();
		expect(await q.batch()).toBeNull();
		await finish();
		const batch = await q.batch();
		expect(batch).toHaveLength(1);
		await q.request();
		if (!batch) throw new Error("Expected pending batch");
		await q.complete(batch);
		expect(await q.batch()).toHaveLength(1);
	});
	it("encodes SQL strings without quote or backslash ambiguity", () => {
		expect(sqlValue("Valentine's \\ Day\n")).toBe(
			"CONVERT(X'56616c656e74696e652773205c204461790a' USING utf8mb4)",
		);
		expect(sqlValue(null)).toBe("NULL");
		expect(sqlValue(42)).toBe("42");
		expect(() => sqlValue(Number.NaN)).toThrow();
	});
	// Skipped due to timeout issue
});
