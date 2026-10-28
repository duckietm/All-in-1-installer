// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	users: [] as any[],
	executes: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const { MySqlDialect } = await import("drizzle-orm/mysql-core");
	const fake = createFakeDb(() => state.users);
	return {
		...schema,
		db: {
			...fake,
			execute: (q: any) => {
				const { sql, params } = new MySqlDialect().sqlToQuery(q);
				state.executes.push({ sql, params });
				return Promise.resolve([{ affectedRows: 1 }]);
			},
		},
	};
});

const perm = vi.hoisted(() => ({ getCtx: vi.fn(), canAccess: vi.fn() }));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	getApiAdminContext: perm.getCtx,
	canAccess: perm.canAccess,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
	addBlacklistWord,
	createPrefix,
	deletePrefix,
	removeBlacklistWord,
	updatePrefix,
	updatePrefixSettings,
} from "./prefixes";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.users = [{ id: 42 }];
	state.executes = [];
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
});

describe("createPrefix", () => {
	it("inserts a prefix for an existing user", async () => {
		const res = await createPrefix({
			username: "alice",
			text: "VIP",
			color: "#fff",
			icon: "star",
			effect: "glow",
			active: 0,
		});
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.executes).toHaveLength(1);
		expect(state.executes[0].sql).toContain("INSERT INTO custom_prefixes");
		expect(state.executes[0].params).toEqual([
			42,
			"VIP",
			"#fff",
			"star",
			"glow",
			0,
		]);
	});

	it("defaults optional fields and active to empty/1", async () => {
		await createPrefix({ username: "alice", text: "VIP", color: "#fff" });
		expect(state.executes[0].params).toEqual([42, "VIP", "#fff", "", "", 1]);
	});

	it("fails when the user does not exist", async () => {
		state.users = [];
		const res = await createPrefix({
			username: "ghost",
			text: "VIP",
			color: "#fff",
		});
		expect(res).toEqual({ ok: false, error: "User not found" });
		expect(state.executes).toHaveLength(0);
	});

	it("validates required fields and active bounds", async () => {
		expect(
			(await createPrefix({ username: "a", text: "", color: "#fff" })).ok,
		).toBe(false);
		expect(
			(
				await createPrefix({
					username: "a",
					text: "x",
					color: "#fff",
					active: 2,
				})
			).ok,
		).toBe(false);
	});
});

describe("updatePrefix", () => {
	it("updates all provided fields", async () => {
		await updatePrefix({
			id: 5,
			text: "NEW",
			color: "#000",
			icon: "i",
			effect: "e",
			active: 0,
		});
		expect(state.executes[0].sql).toContain("UPDATE custom_prefixes");
		expect(state.executes[0].params).toEqual(["NEW", "#000", "i", "e", 0, 5]);
	});

	it("falls back to active=1 and empty icon/effect", async () => {
		await updatePrefix({ id: 5, text: "NEW", color: "#000" });
		expect(state.executes[0].params).toEqual(["NEW", "#000", "", "", 1, 5]);
	});
});

describe("deletePrefix", () => {
	it("deletes by id", async () => {
		const res = await deletePrefix({ id: 9 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.executes[0].sql).toContain("DELETE FROM custom_prefixes");
		expect(state.executes[0].params).toEqual([9]);
	});
});

describe("blacklist words", () => {
	it("inserts a trimmed word", async () => {
		await addBlacklistWord({ word: "  bad  " });
		expect(state.executes[0].sql).toContain("custom_prefix_blacklist");
		expect(state.executes[0].params).toEqual(["bad"]);
	});

	it("rejects an oversized or empty word", async () => {
		expect((await addBlacklistWord({ word: "" })).ok).toBe(false);
		expect((await addBlacklistWord({ word: "x".repeat(101) })).ok).toBe(false);
	});

	it("removes a word by id", async () => {
		await removeBlacklistWord({ id: 3 });
		expect(state.executes[0].sql).toContain(
			"DELETE FROM custom_prefix_blacklist",
		);
		expect(state.executes[0].params).toEqual([3]);
	});
});

describe("updatePrefixSettings", () => {
	it("upserts only whitelisted keys", async () => {
		const res = await updatePrefixSettings({
			settings: { enabled: "1", bogus: "x", max_length: "10" },
		});
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.executes).toHaveLength(2);
		const keys = state.executes.map((e) => e.params[0]);
		expect(keys).toEqual(["enabled", "max_length"]);
		expect(state.executes[0].sql).toContain("custom_prefix_settings");
	});

	it("does nothing when every key is unknown", async () => {
		await updatePrefixSettings({ settings: { nope: "1" } });
		expect(state.executes).toHaveLength(0);
	});
});

describe("authorization", () => {
	it("returns Unauthorized without a context", async () => {
		perm.getCtx.mockResolvedValue(null);
		expect(await deletePrefix({ id: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	it("denies prefix edits without permission", async () => {
		perm.canAccess.mockReturnValue(false);
		expect(
			await createPrefix({ username: "a", text: "x", color: "y" }),
		).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});
