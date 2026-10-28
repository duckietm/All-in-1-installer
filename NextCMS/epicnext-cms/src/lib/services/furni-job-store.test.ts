// @ts-nocheck
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ImportJob } from "@/lib/furni/import-job";
import { ImportJobStore } from "./furni-job-store";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await fs.rm(root, { recursive: true, force: true });
});
const job = (): ImportJob => ({
	id: randomUUID(),
	userId: 4,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	state: "queued",
	translate: false,
	items: [],
});
async function store() {
	const root = await fs.mkdtemp(path.join(tmpdir(), "furni-jobs-test-"));
	roots.push(root);
	return new ImportJobStore(root);
}
it("persists history across store instances", async () => {
	const s = await store(),
		j = job();
	await s.create(j);
	expect(await new ImportJobStore(s.root).read(j.id)).toEqual(j);
});
it("deduplicates concurrent submissions of the same request", async () => {
	const s = await store(),
		j = job();
	await Promise.all([s.create(j), s.create(j)]);
	expect(await s.list()).toHaveLength(1);
});
it("does not overwrite a completed job on a repeated request", async () => {
	const s = await store(),
		j = job();
	await s.create(j);
	await s.save({ ...j, state: "completed" });
	expect((await s.create(j)).state).toBe("completed");
});
it("rejects another user attempting to reuse an ID", async () => {
	const s = await store(),
		j = job();
	await s.create(j);
	await expect(s.create({ ...j, userId: 8 })).rejects.toThrow(
		"Request ID already used",
	);
});
it("rejects unsafe job paths", async () => {
	const s = await store();
	await expect(s.create({ ...job(), id: "../escape" })).rejects.toThrow(
		"Invalid import ID",
	);
	await expect(s.read("../escape")).rejects.toThrow("Invalid import ID");
});

it("cancellation survives a stale worker save", async () => {
	const s = await store(),
		j = job();
	await s.create(j);
	expect((await s.requestCancellation(j.id, j.userId))?.cancelRequested).toBe(
		true,
	);
	await s.save({ ...j, state: "running" });
	expect(await s.isCancellationRequested(j.id)).toBe(true);
	expect((await s.read(j.id)).cancelRequested).toBe(true);
});
it("rejects cancellation by a different operator and is idempotent for the owner", async () => {
	const s = await store(),
		j = job();
	await s.create(j);
	expect(await s.requestCancellation(j.id, 99)).toBeNull();
	expect(await s.isCancellationRequested(j.id)).toBe(false);
	await Promise.all([
		s.requestCancellation(j.id, j.userId),
		s.requestCancellation(j.id, j.userId),
	]);
	expect(await s.isCancellationRequested(j.id)).toBe(true);
});
it("does not alter completed jobs when cancellation arrives late", async () => {
	const s = await store(),
		j = { ...job(), state: "completed" as const };
	await s.create(j);
	expect((await s.requestCancellation(j.id, j.userId))?.state).toBe(
		"completed",
	);
	expect(await s.isCancellationRequested(j.id)).toBe(false);
});
it("loads bounded history for the requesting owner", async () => {
	const s = await store();
	for (let i = 0; i < 5; i++)
		await s.create({ ...job(), userId: i % 2 === 0 ? 4 : 8 });
	const result = await s.list({ userId: 4, limit: 2 });
	expect(result).toHaveLength(2);
	expect(result.every((job) => job.userId === 4)).toBe(true);
});

it("keeps history pages stable while an older job changes", async () => {
	const s = await store();
	const older = { ...job(), createdAt: "2026-01-01T00:00:00.000Z" };
	const newer = { ...job(), createdAt: "2026-01-02T00:00:00.000Z" };
	await s.create(older);
	await s.create(newer);
	const first = await s.page({ userId: 4, limit: 1 });
	expect(first.jobs.map((j) => j.id)).toEqual([newer.id]);
	await s.save({ ...older, state: "completed" });
	const second = await s.page({
		userId: 4,
		limit: 1,
		before: first.nextCursor ?? undefined,
	});
	expect(second.jobs.map((j) => j.id)).toEqual([older.id]);
	expect(second.nextCursor).toBeNull();
});
it("creates a single retry across concurrent requests and excludes successful items", async () => {
	const s = await store();
	const original = {
		...job(),
		state: "completed" as const,
		items: [
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "",
				state: "failed" as const,
			},
			{
				id: 2,
				classname: "lamp",
				name: "Lamp",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "",
				state: "done" as const,
			},
		],
	};
	await s.create(original);
	const [a, b] = await Promise.all([
		s.retry(original.id, 4),
		s.retry(original.id, 4),
	]);
	expect(a?.id).toBe(b?.id);
	expect(a?.items.map((i) => i.classname)).toEqual(["chair"]);
	expect(await s.list()).toHaveLength(2);
	expect(await s.retry(original.id, 99)).toBeNull();
});

it("does not retry active jobs or uncertain outcomes", async () => {
	const s = await store();
	const original = {
		...job(),
		items: [
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "",
				state: "interrupted" as const,
			},
		],
	};
	await s.create(original);
	expect(await s.retry(original.id, 4)).toBeNull();
	await s.save({ ...original, state: "interrupted" });
	expect(await s.retry(original.id, 4)).toBeNull();
	expect(await s.list()).toHaveLength(1);
});
it("paginates timestamp ties without duplicates and excludes other owners", async () => {
	const s = await store();
	const createdAt = "2026-01-01T00:00:00.000Z";
	const own = [
		{ ...job(), createdAt },
		{ ...job(), createdAt },
		{ ...job(), createdAt },
	];
	for (const entry of [...own, { ...job(), createdAt, userId: 99 }])
		await s.create(entry);
	const first = await s.page({ userId: 4, limit: 2 });
	const second = await s.page({
		userId: 4,
		limit: 2,
		before: first.nextCursor ?? undefined,
	});
	expect(new Set([...first.jobs, ...second.jobs].map((j) => j.id))).toEqual(
		new Set(own.map((j) => j.id)),
	);
	expect(first.jobs.length + second.jobs.length).toBe(3);
});
it("attaches recovery files only to safe failed items and preserves retry history", async () => {
	const s = await store();
	const original: ImportJob = {
		...job(),
		state: "completed",
		items: [
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "",
				state: "failed",
			},
			{
				id: 2,
				classname: "lamp",
				name: "Lamp",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "",
				state: "done",
			},
		],
	};
	await s.create(original);
	await expect(s.retry(original.id, 4, { lamp: randomUUID() })).rejects.toThrow(
		"not eligible",
	);
	const attachmentId = randomUUID();
	const child = await s.retry(original.id, 4, { chair: attachmentId });
	expect(child?.items).toHaveLength(1);
	expect(child?.items[0].attachmentId).toBe(attachmentId);
	expect((await s.read(original.id)).items[0].attachmentId).toBeUndefined();
	await expect(
		s.retry(original.id, 4, { chair: randomUUID() }),
	).rejects.toThrow("latest retry");
});

it("clears old source provenance, request identity and phase when creating a retry", async () => {
	const s = await store();
	const original: ImportJob = {
		...job(),
		state: "completed",
		requestFingerprint: "original-request",
		items: [
			{
				id: 1,
				classname: "chair",
				name: "Chair",
				description: "",
				type: "flooritem",
				revision: 1,
				category: "other",
				state: "failed",
				phase: "converting",
				phaseStartedAt: new Date().toISOString(),
				sourceAttempt: "Old source",
				recoveredSource: {
					sourceId: "old",
					sourceName: "Old source",
					revision: 1,
				},
			},
		],
	};
	await s.create(original);
	const child = await s.retry(original.id, 4);
	expect(child?.requestFingerprint).toBeUndefined();
	expect(child?.items[0].phase).toBeUndefined();
	expect(child?.items[0].recoveredSource).toBeUndefined();
	expect(child?.items[0].sourceAttempt).toBeUndefined();
});

it("rejects reuse of a request ID with a different immutable fingerprint", async () => {
	const s = await store();
	const original = { ...job(), requestFingerprint: "original" };
	await s.create(original);
	await expect(
		s.create({ ...original, requestFingerprint: "changed" }),
	).rejects.toThrow("Request ID already used");
	expect((await s.read(original.id)).requestFingerprint).toBe("original");
});
it("preserves the request identity while checkpoint data changes", async () => {
	const s = await store();
	const original = { ...job(), requestFingerprint: "original" };
	await s.create(original);
	await s.save({ ...original, state: "completed" });
	expect((await s.create(original)).state).toBe("completed");
});
it("does not guess request identity for legacy jobs without a fingerprint", async () => {
	const s = await store();
	const original = job();
	await s.create(original);
	await expect(
		s.create({ ...original, requestFingerprint: "new" }),
	).rejects.toThrow("Request ID already used");
});

it("rejects concurrent conflicting submissions without overwriting the winner", async () => {
	const s = await store();
	const original = { ...job(), requestFingerprint: "one" };
	const results = await Promise.allSettled([
		s.create(original),
		s.create({ ...original, requestFingerprint: "two" }),
	]);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toHaveLength(
		1,
	);
	expect(await s.list()).toHaveLength(1);
});
