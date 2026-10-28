// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({
	allowed: [] as string[],
	watches: [] as {
		id: number;
		staffId: number;
		targetUserId: number;
		reason: string;
	}[],
	insertCall: undefined as unknown,
	deleteCall: undefined as unknown,
}));

const actionErrorClass = vi.hoisted(
	() =>
		class ActionError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "ActionError";
			}
		},
);

vi.mock("@/lib/safe-action", () => ({
	adminAction: (
		opts: { permission?: string | readonly string[]; schema?: z.ZodType },
		handler: (ctx: any) => unknown,
	) => {
		return async (input: unknown) => {
			const needed = Array.isArray(opts.permission)
				? opts.permission
				: [opts.permission ?? ""];
			if (!needed.some((slug) => state.allowed.includes(slug))) {
				return { ok: false, error: "Unauthorized" };
			}
			const ctx: any = {
				session: { user: { id: 100, name: "staff", rank: 10 } },
			};
			if (opts.schema) {
				const parsed = opts.schema.safeParse(input);
				if (!parsed.success) {
					return {
						ok: false,
						error: "Validation failed",
						fieldErrors: z.flattenError(parsed.error).fieldErrors,
					};
				}
				ctx.data = parsed.data;
			} else {
				ctx.data = input;
			}
			try {
				return await handler(ctx);
			} catch (error) {
				if (error instanceof actionErrorClass) throw error;
				throw error;
			}
		};
	},
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: actionErrorClass,
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/permission-slugs", () => ({
	PERMS: { USERS_VIEW: "admin.users.view" },
}));

const mockRevalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const db = createFakeDb((table) => {
		if (table === schema.UserWatch) return state.watches;
		return [];
	});
	db.insert = vi.fn((table) => ({
		values: (values: {
			staffId: number;
			targetUserId: number;
			reason: string;
		}) => {
			state.insertCall = { table, values };
			return Promise.resolve([{ insertId: 1n }]);
		},
	}));
	db.delete = vi.fn((table) => ({
		where: (condition: unknown) => {
			state.deleteCall = { table, condition };
			return Promise.resolve([{ affectedRows: 1 }]);
		},
	}));
	return { ...schema, db };
});

import { toggleUserWatch } from "./watch";

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = ["admin.users.view"];
	state.watches = [];
	state.insertCall = undefined;
	state.deleteCall = undefined;
});

describe("toggleUserWatch", () => {
	it("creates a watch when none exists and returns watching: true", async () => {
		const res = await toggleUserWatch({
			targetUserId: 42,
			reason: "suspicious",
		});
		expect(res).toEqual({ ok: true, data: { watching: true } });
		expect(state.insertCall.values).toEqual({
			staffId: 100,
			targetUserId: 42,
			reason: "suspicious",
		});
		expect(mockRevalidateTag).toHaveBeenCalledWith("user-watch:100", {
			expire: 0,
		});
	});

	it("defaults the reason to an empty string", async () => {
		await toggleUserWatch({ targetUserId: 7 });
		expect(state.insertCall.values).toEqual({
			staffId: 100,
			targetUserId: 7,
			reason: "",
		});
	});

	it("removes an existing watch and returns watching: false", async () => {
		state.watches = [{ id: 9, staffId: 100, targetUserId: 42, reason: "x" }];
		const res = await toggleUserWatch({ targetUserId: 42 });
		expect(res).toEqual({ ok: true, data: { watching: false } });
		expect(state.deleteCall.condition).toBeDefined();
		expect(mockRevalidateTag).toHaveBeenCalledWith("user-watch:100", {
			expire: 0,
		});
	});

	it("requires the users view permission", async () => {
		state.allowed = [];
		expect(await toggleUserWatch({ targetUserId: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	it("rejects invalid target user ids and oversized reasons", async () => {
		expect(await toggleUserWatch({ targetUserId: -1 })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
		expect(await toggleUserWatch({ targetUserId: 0 })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
		expect(
			await toggleUserWatch({ targetUserId: 1, reason: "x".repeat(256) }),
		).toMatchObject({ ok: false, error: "Validation failed" });
	});
});
