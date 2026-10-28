// @ts-nocheck
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	token: {
		id: "9",
		tokenable_id: "42",
		tokenable_type: "App\\Models\\User",
		abilities: '["*"]',
	} as Record<string, unknown>,
	found: true,
	fail: false,
	queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			state.queries.push({ sql, params });
			if (state.fail) throw Error("database failure containing private data");
			if (!sql.startsWith("select ")) return { rows: [] };
			const columns = sql
				.slice(7, sql.indexOf(" from "))
				.split(", ")
				.map((column) => column.replaceAll("`", ""));
			return {
				rows: state.found ? [columns.map((column) => state.token[column])] : [],
			};
		}),
	};
});

import { bearerUserId } from "./api-auth";

const request = (token = "test-token") =>
	new Request("https://hotel.test/api/tickets", {
		headers: { authorization: `Bearer ${token}` },
	});
beforeEach(() => {
	state.token = {
		id: "9",
		tokenable_id: "42",
		tokenable_type: "App\\Models\\User",
		abilities: '["*"]',
	};
	state.found = true;
	state.fail = false;
	state.queries = [];
});

describe("personal bearer token authorization", () => {
	it.each(["test-token", "9|test-token"])(
		"preserves full-access token format %s",
		async (value) => {
			expect(await bearerUserId(request(value))).toBe(42);
			expect(state.queries[0].params).toContain(
				createHash("sha256").update("test-token").digest("hex"),
			);
			expect(state.queries[0].params).not.toContain("test-token");
		},
	);
	it("requires the exact user owner model and an unexpired token in the query", async () => {
		await bearerUserId(request());
		expect(state.queries[0].sql).toContain("`tokenable_type` = ?");
		expect(state.queries[0].params).toContain("App\\Models\\User");
		expect(state.queries[0].sql).toContain("`expires_at` is null");
		expect(state.queries[0].sql).toContain("`expires_at` > ?");
	});
	it.each(["App\\Models\\Admin", "app\\models\\user", "App\\User", ""])(
		"rejects a token belonging to %s before recording use",
		async (owner) => {
			state.token.tokenable_type = owner;
			expect(await bearerUserId(request())).toBeNull();
			expect(
				state.queries.some((query) => query.sql.startsWith("update ")),
			).toBe(false);
		},
	);
	it.each([
		null,
		"",
		"not-json",
		'"*"',
		"{}",
		"[]",
		"[null]",
		'["*",false]',
		'["tickets:read",""]',
	])("denies malformed or empty abilities %s", async (abilities) => {
		state.token.abilities = abilities;
		expect(await bearerUserId(request())).toBeNull();
		expect(state.queries.some((query) => query.sql.startsWith("update "))).toBe(
			false,
		);
	});
	it("does not treat scoped tokens as unrestricted when the caller omits required abilities", async () => {
		state.token.abilities = '["tickets:read"]';
		expect(await bearerUserId(request())).toBeNull();
		expect(await bearerUserId(request(), [])).toBeNull();
	});
	it("allows only explicitly granted domains and operations", async () => {
		state.token.abilities = '["tickets:read","radio:read"]';
		expect(await bearerUserId(request(), ["tickets:read"])).toBe(42);
		expect(await bearerUserId(request(), ["tickets:write"])).toBeNull();
		expect(await bearerUserId(request(), ["articles:write"])).toBeNull();
		expect(
			await bearerUserId(request(), ["tickets:read", "tickets:write"]),
		).toBeNull();
	});
	it("retains wildcard compatibility for explicitly scoped endpoints", async () => {
		expect(await bearerUserId(request(), ["tickets:write", "radio:read"])).toBe(
			42,
		);
	});
	it("does not interpret domain wildcards or whitespace as permissions", async () => {
		state.token.abilities = '["tickets:*", " tickets:read"]';
		expect(await bearerUserId(request(), ["tickets:read"])).toBeNull();
	});
	it.each(["0", "9007199254740993"])(
		"rejects invalid user id %s without recording use",
		async (id) => {
			state.token.tokenable_id = id;
			expect(await bearerUserId(request(), ["tickets:read"])).toBeNull();
			expect(
				state.queries.some((query) => query.sql.startsWith("update ")),
			).toBe(false);
		},
	);
	it("fails closed on database errors and absent tokens", async () => {
		state.fail = true;
		expect(await bearerUserId(request(), ["tickets:read"])).toBeNull();
		state.fail = false;
		state.found = false;
		expect(await bearerUserId(request(), ["tickets:read"])).toBeNull();
	});
});
