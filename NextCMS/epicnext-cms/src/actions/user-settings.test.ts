// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({
	auth: vi.fn(),
	authSession: undefined as { user: { id: string; name: string } } | null,
	updateCall: undefined as unknown,
	rconSetMotto: vi.fn(),
	failDbUpdate: false,
	isAllowed: vi.fn(async () => ({ ok: true })),
}));

const databaseErrorClass = vi.hoisted(
	() =>
		class DatabaseError extends Error {
			constructor(message: string, cause?: unknown) {
				super(message);
				this.name = "DatabaseError";
				this.cause = cause;
			}
		},
);

vi.mock("@/lib/auth", () => ({ auth: state.auth }));

vi.mock("@/lib/foundation/action", () => ({
	authAction: (
		opts: { schema?: z.ZodType },
		handler: (ctx: any) => unknown,
	) => {
		return async (input: unknown) => {
			const session = await state.auth();
			if (!session?.user) return { ok: false, error: "Unauthorized" };
			const ctx: any = {
				session: {
					user: { id: Number(session.user.id), name: session.user.name },
				},
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
			return handler(ctx);
		};
	},
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/foundation/errors", () => ({
	DatabaseError: databaseErrorClass,
}));

vi.mock("@/lib/services/rcon", () => ({
	rcon: { setMotto: state.rconSetMotto },
}));

vi.mock("@/lib/services/moderation", () => ({
	isAllowed: state.isAllowed,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const db = createFakeDb(() => []);
	db.update = vi.fn((table) => ({
		set: (values: unknown) => ({
			where: () => {
				state.updateCall = { table, values };
				if (state.failDbUpdate)
					return Promise.reject(new Error("connection lost"));
				return Promise.resolve([{ affectedRows: 1 }]);
			},
		}),
	}));
	return { ...schema, db };
});

import { DatabaseError } from "@/lib/foundation/errors";
import { updateMotto, updateMottoAction } from "./user-settings";

const mockingForm = (motto: string): FormData =>
	({
		get: (key: string) => (key === "motto" ? motto : null),
	}) as unknown as FormData;

beforeEach(() => {
	vi.clearAllMocks();
	state.auth.mockResolvedValue({ user: { id: "42", name: "player" } });
	state.authSession = null;
	state.updateCall = undefined;
	state.rconSetMotto.mockResolvedValue(true);
	state.failDbUpdate = false;
	state.isAllowed.mockResolvedValue({ ok: true });
});

describe("updateMotto", () => {
	it("persists the motto, syncs RCON and revalidates /settings", async () => {
		await updateMotto(mockingForm("  hello world  "));
		expect(state.updateCall.values).toEqual({ motto: "  hello world  " });
		expect(state.rconSetMotto).toHaveBeenCalledWith(42, "  hello world  ");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
	});

	it("normalises NFC and truncates the motto to 127 characters", async () => {
		const long = "é".repeat(200);
		await updateMotto(mockingForm(long));
		expect(state.updateCall.values.motto).toHaveLength(127);
		expect(state.rconSetMotto).toHaveBeenCalledWith(42, "é".repeat(127));
	});

	it("still succeeds when RCON fails (best-effort sync)", async () => {
		state.rconSetMotto.mockRejectedValue(new Error("emulator down"));
		await updateMotto(mockingForm("ok"));
		expect(state.updateCall.values).toEqual({ motto: "ok" });
		expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
	});

	it("throws a DatabaseError when the DB update fails", async () => {
		state.failDbUpdate = true;
		await expect(updateMotto(mockingForm("boom"))).rejects.toThrow(
			databaseErrorClass,
		);
		await expect(updateMotto(mockingForm("boom"))).rejects.toThrow(
			"Failed to update motto",
		);
	});

	it("does not sync RCON when the DB update fails", async () => {
		state.failDbUpdate = true;
		await expect(updateMotto(mockingForm("boom"))).rejects.toThrow(
			databaseErrorClass,
		);
		expect(state.rconSetMotto).not.toHaveBeenCalled();
	});
});

describe("updateMotto word filter", () => {
	it("rejects a motto blocked by the word filter before persisting", async () => {
		state.isAllowed.mockResolvedValue({ ok: false, reason: "bad" });
		await expect(updateMotto(mockingForm("bad motto"))).rejects.toThrow(
			databaseErrorClass,
		);
		expect(state.isAllowed).toHaveBeenCalledWith("bad motto");
		expect(state.updateCall).toBeUndefined();
		expect(state.rconSetMotto).not.toHaveBeenCalled();
	});
});

describe("updateMottoAction", () => {
	it("denies unauthenticated callers", async () => {
		state.auth.mockResolvedValue(null);
		expect(await updateMottoAction({ motto: "nope" })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
		expect(state.updateCall).toBeUndefined();
	});

	it("rejects mottos longer than 127 characters", async () => {
		const res = await updateMottoAction({ motto: "x".repeat(128) });
		expect(res).toMatchObject({ ok: false, error: "Validation failed" });
		expect(state.updateCall).toBeUndefined();
	});
});

describe("schema boundary", () => {
	it("accepts exactly 127 characters", async () => {
		const res = await updateMottoAction({ motto: "x".repeat(127) });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.updateCall.values).toEqual({ motto: "x".repeat(127) });
	});

	it("rejects non-string mottos", async () => {
		expect(
			await updateMottoAction({ motto: 5 as unknown as string }),
		).toMatchObject({ ok: false, error: "Validation failed" });
	});
});

describe("DatabaseError propagation", () => {
	it("is an instance of the exported error class", () => {
		const err = new databaseErrorClass("db");
		expect(err).toBeInstanceOf(DatabaseError);
		expect(err.name).toBe("DatabaseError");
	});
});
