// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";
import type { ImportJob } from "@/lib/furni/import-job";

const mocks = vi.hoisted(() => ({
	set: vi.fn(),
	eval: vi.fn(),
	list: vi.fn(),
	cancel: vi.fn(),
	save: vi.fn(),
	import: vi.fn(),
	attachment: vi.fn(),
	export: vi.fn(),
	translate: vi.fn(),
	updateCatalog: vi.fn(),
	updateItems: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: { set: mocks.set, eval: mocks.eval } }));
vi.mock("@/lib/server-log", () => ({ logServerError: vi.fn() }));
vi.mock("./audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./catalog-git-queue", () => ({ withCatalogExport: mocks.export }));
vi.mock("./clone-sources", () => ({ getSource: async () => null }));
vi.mock("./furni-job-store", () => ({
	ImportJobStore: class {
		list = mocks.list;
		isCancellationRequested = mocks.cancel;
		save = mocks.save;
	},
}));
vi.mock("./furni-import", () => ({
	ensureDirectories: async () => {},
	importSingleFurni: mocks.import,
}));
vi.mock("./furni-data-i18n", () => ({
	patchLocalizedFurniDataEntries: mocks.translate,
}));
vi.mock("./furni-attachment", () => ({
	readFurnitureAttachment: mocks.attachment,
}));
vi.mock("./rcon", () => ({
	rcon: { updateCatalog: mocks.updateCatalog, updateItems: mocks.updateItems },
}));

vi.mock("./catalog-git-export", () => ({ runCatalogExport: vi.fn() }));

vi.mock("./furni-sync-item", () => ({ runSyncJobItem: mocks.import }));

import { drainFurnitureImports } from "./furni-job-worker";

let job: ImportJob;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.set.mockResolvedValue("OK");
	mocks.cancel.mockResolvedValue(false);
	mocks.eval.mockResolvedValue(1);
	mocks.export.mockImplementation((fn) => fn());
	mocks.import.mockResolvedValue({ ok: true, itemId: 900, warnings: [] });
	mocks.save.mockResolvedValue(undefined);
	mocks.updateCatalog.mockResolvedValue(undefined);
	mocks.updateItems.mockResolvedValue(undefined);
	mocks.translate.mockResolvedValue(undefined);
	job = {
		id: "job",
		userId: 5,
		createdAt: "now",
		updatedAt: "now",
		state: "queued",
		translate: false,
		items: [
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "other",
				state: "pending",
			},
		],
	};
	mocks.list.mockResolvedValue([job]);
});
it("imports with repair enabled and saves the allocated local ID", async () => {
	await drainFurnitureImports();
	expect(mocks.import).toHaveBeenCalledWith(
		expect.objectContaining({ classname: "chair", repairExisting: true }),
	);
	expect(job.state).toBe("completed");
	expect(job.items[0]).toMatchObject({ state: "done", itemId: 900 });
	expect(mocks.export).toHaveBeenCalledOnce();
});
it("does not run a second worker while another holds the lease", async () => {
	mocks.set.mockResolvedValue(null);
	await drainFurnitureImports();
	expect(mocks.import).not.toHaveBeenCalled();
});
it("marks abandoned work interrupted without repeating an uncertain import", async () => {
	job.state = "running";
	job.items[0].state = "running";
	await drainFurnitureImports();
	expect(job.state).toBe("interrupted");
	expect(job.items[0].state).toBe("interrupted");
	expect(mocks.import).not.toHaveBeenCalled();
});
it("keeps errors for failed items and continues the batch", async () => {
	job.items.push({ ...job.items[0], classname: "table" });
	mocks.import.mockResolvedValueOnce({
		ok: false,
		error: "Missing asset",
		warnings: [],
	});
	await drainFurnitureImports();
	expect(job.items.map((i) => i.state)).toEqual(["failed", "done"]);
	expect(job.items[0].error).toBe("Missing asset");
});
it("loads attachments using the job owner and exact classname", async () => {
	job.items[0].attachmentId = "upload";
	mocks.attachment.mockResolvedValue(Buffer.from("verified"));
	await drainFurnitureImports();
	expect(mocks.attachment).toHaveBeenCalledWith("upload", "chair", 5);
	expect(mocks.import).toHaveBeenCalledWith(
		expect.objectContaining({ providedNitro: Buffer.from("verified") }),
	);
});

it("cancels queued work without importing any items", async () => {
	mocks.cancel.mockResolvedValue(true);
	await drainFurnitureImports();
	expect(job.state).toBe("cancelled");
	expect(job.items[0].state).toBe("cancelled");
	expect(mocks.import).not.toHaveBeenCalled();
});
it("finishes the in-flight item and cancels only the remaining items", async () => {
	job.items.push({ ...job.items[0], classname: "table" });
	mocks.import.mockImplementationOnce(async () => {
		mocks.cancel.mockResolvedValue(true);
		return { ok: true, itemId: 900, warnings: [] };
	});
	await drainFurnitureImports();
	expect(job.state).toBe("cancelled");
	expect(job.items.map((item) => item.state)).toEqual(["done", "cancelled"]);
	expect(mocks.import).toHaveBeenCalledOnce();
});
it("reports completion if cancellation arrives during the final item", async () => {
	mocks.import.mockImplementationOnce(async () => {
		mocks.cancel.mockResolvedValue(true);
		return { ok: true, itemId: 900, warnings: [] };
	});
	await drainFurnitureImports();
	expect(job.state).toBe("completed");
});
it("preserves pending items when recovery finds an uncertain in-flight import", async () => {
	job.state = "running";
	job.items[0].state = "running";
	job.items.push({ ...job.items[0], classname: "table", state: "pending" });
	await drainFurnitureImports();
	expect(job.items.map((item) => item.state)).toEqual([
		"interrupted",
		"pending",
	]);
	expect(mocks.import).not.toHaveBeenCalled();
});

it("does not overwrite another worker's interruption after losing ownership during the final import", async () => {
	let persisted: ImportJob | undefined;
	mocks.save.mockImplementation(async (value: ImportJob) => {
		persisted = structuredClone(value);
	});
	mocks.import.mockImplementationOnce(async () => {
		persisted = {
			...structuredClone(job),
			state: "interrupted",
			items: job.items.map((item) => ({ ...item, state: "interrupted" })),
		};
		mocks.eval.mockResolvedValue(0);
		return { ok: true, itemId: 900, warnings: [] };
	});
	await drainFurnitureImports();
	expect(mocks.import).toHaveBeenCalledOnce();
	expect(mocks.save).toHaveBeenCalledTimes(2);
	expect(persisted?.state).toBe("interrupted");
	expect(persisted?.items[0].state).toBe("interrupted");
	expect(mocks.updateCatalog).not.toHaveBeenCalled();
});
it("keeps an uncertain import running on disk when lease verification fails", async () => {
	const snapshots: ImportJob[] = [];
	mocks.save.mockImplementation(async (value: ImportJob) => {
		snapshots.push(structuredClone(value));
	});
	mocks.import.mockImplementationOnce(async () => {
		mocks.eval.mockRejectedValue(new Error("Redis unavailable"));
		throw new Error("SQL outcome unknown");
	});
	await drainFurnitureImports();
	expect(snapshots).toHaveLength(2);
	expect(snapshots.at(-1)?.items[0].state).toBe("running");
	expect(snapshots.some((value) => value.state === "completed")).toBe(false);
});
it("does not persist final completion when ownership changes during cache refresh", async () => {
	const snapshots: ImportJob[] = [];
	mocks.save.mockImplementation(async (value: ImportJob) => {
		snapshots.push(structuredClone(value));
	});
	mocks.updateCatalog.mockImplementationOnce(async () => {
		mocks.eval.mockResolvedValue(0);
	});
	await drainFurnitureImports();
	expect(snapshots.at(-1)?.state).toBe("running");
	expect(snapshots.at(-1)?.items[0].state).toBe("done");
	expect(snapshots.some((value) => value.state === "completed")).toBe(false);
	expect(mocks.updateItems).not.toHaveBeenCalled();
});
it("does not save a translated outcome after ownership is lost during translation", async () => {
	const snapshots: ImportJob[] = [];
	job.translate = true;
	mocks.save.mockImplementation(async (value: ImportJob) => {
		snapshots.push(structuredClone(value));
	});
	mocks.translate.mockImplementationOnce(async () => {
		mocks.eval.mockResolvedValue(0);
	});
	await drainFurnitureImports();
	expect(mocks.translate).toHaveBeenCalledOnce();
	expect(snapshots).toHaveLength(3);
	expect(snapshots.at(-1)?.items[0].state).toBe("running");
	expect(mocks.updateCatalog).not.toHaveBeenCalled();
});

it("restores the original operation context while running a durable job", async () => {
	const { getOperationContext } = await import(
		"@/lib/foundation/request-context"
	);
	job.operationId = "original-operation";
	mocks.import.mockImplementation(async () => {
		expect(getOperationContext()).toEqual({
			operationId: "original-operation",
			userId: 5,
		});
		return { ok: true, itemId: 900, warnings: [] };
	});
	await drainFurnitureImports();
	expect(getOperationContext()).toEqual({});
});

it("keeps successful imports complete if their audit write fails", async () => {
	const { logAudit } = await import("./audit");
	vi.mocked(logAudit).mockRejectedValueOnce(new Error("Audit unavailable"));
	await drainFurnitureImports();
	expect(job.items[0].state).toBe("done");
	expect(job.items[0].warnings).toContain("Audit record could not be saved");
});

it("persists progress before continuing an import and retains the failed phase", async () => {
	mocks.import.mockImplementationOnce(async (params) => {
		await params.onProgress("downloading");
		expect(job.items[0].phase).toBe("downloading");
		expect(mocks.save).toHaveBeenCalled();
		await params.onProgress("converting");
		throw Error("Conversion failed");
	});
	await drainFurnitureImports();
	expect(job.items[0]).toMatchObject({ state: "failed", phase: "converting" });
	expect(job.items[0].phaseStartedAt).toBeTruthy();
});
