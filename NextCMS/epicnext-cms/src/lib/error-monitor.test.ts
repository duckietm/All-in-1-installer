// @ts-nocheck
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createErrorRecord, ErrorStore } from "./error-monitor";

it("redacts secrets in messages, stack and context while retaining a reference", () => {
	const r = createErrorRecord(
		"server",
		"payment.failed",
		new Error("https://user:password@host/a?token=abc password=hello"),
		{
			token: "secret",
			path: "/a?session=hidden",
			nested: { password: "never" },
		},
	);
	const text = JSON.stringify(r);
	for (const secret of ["password@", "token=abc", "hello", "hidden", "never"])
		expect(text).not.toContain(secret);
	expect(r.id).toBeTruthy();
	expect(r.stack).toContain("Error");
});
it("persists across instances and groups repeated errors without losing references", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "cms-errors-"));
	try {
		const store = new ErrorStore(dir);
		const a = createErrorRecord("server", "test", new Error("failed"));
		await store.append(a);
		await store.append({ ...a, id: "second" });
		const result = await new ErrorStore(dir).read();
		expect(result.records).toHaveLength(2);
		expect(result.records[0].fingerprint).toBe(result.records[1].fingerprint);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("resolves a group and reopens it when a later occurrence arrives", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "cms-errors-"));
	try {
		const store = new ErrorStore(dir);
		const a = createErrorRecord("server", "test", new Error("failed"));
		await store.append(a);
		await store.resolve(a.fingerprint);
		expect((await store.read()).records[0].resolved).toBe(true);
		await store.append({
			...a,
			id: "later",
			at: new Date(Date.now() + 1000).toISOString(),
		});
		expect((await store.read()).records[0].resolved).toBe(false);
		await expect(store.resolve("../escape")).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("persists assignments across instances and clears them without modifying resolution", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "cms-errors-"));
	try {
		const store = new ErrorStore(dir);
		const record = createErrorRecord("server", "assign", "failed");
		await store.append(record);
		await store.resolve(record.fingerprint);
		await store.assign(record.fingerprint, 42);
		const persisted = (await new ErrorStore(dir).read()).records[0];
		expect(persisted.assignment?.userId).toBe(42);
		expect(persisted.resolved).toBe(true);
		await new ErrorStore(dir).assign(record.fingerprint, null);
		expect((await store.read()).records[0].assignment).toBeNull();
		await expect(store.assign("../escape", 42)).rejects.toThrow(
			"Invalid fingerprint",
		);
		await expect(store.assign(record.fingerprint, -1)).rejects.toThrow(
			"Invalid assignee",
		);
		await expect(store.assign("0000000000000000", 42)).rejects.toThrow(
			"no longer available",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("ignores expired assignment metadata and prunes it with error retention", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "cms-errors-"));
	try {
		const record = createErrorRecord("server", "retention", "failed");
		const expired = `2000-01-01.${record.fingerprint}.assignment`;
		await writeFile(
			path.join(dir, expired),
			JSON.stringify({ userId: 99, at: "2000-01-01T00:00:00Z" }),
		);
		const store = new ErrorStore(dir);
		await store.append(record);
		expect((await store.read()).records[0].assignment).toBeNull();
		expect(await readdir(dir)).not.toContain(expired);
		const current = `${record.at.slice(0, 10)}.${record.fingerprint}.assignment`;
		await writeFile(path.join(dir, current), "x".repeat(513));
		expect((await store.read()).records[0].assignment).toBeNull();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
