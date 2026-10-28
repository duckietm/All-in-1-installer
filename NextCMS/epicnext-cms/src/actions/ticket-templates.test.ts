// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({
	allowed: [] as string[],
	existing: [] as { id: number }[],
	insertCall: undefined as unknown,
	updateCall: undefined as unknown,
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
				if (error instanceof actionErrorClass) {
					return { ok: false, error: error.message };
				}
				throw error;
			}
		};
	},
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: actionErrorClass,
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { TICKETS_EDIT: "admin.tickets.edit" },
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const db = createFakeDb((table) => {
		if (table === schema.WebsiteTicketTemplate) return state.existing;
		return [];
	});
	db.insert = vi.fn((table) => ({
		values: (values: unknown) => {
			state.insertCall = { table, values };
			return Promise.resolve([{ insertId: 73n }]);
		},
	}));
	db.update = vi.fn((table) => ({
		set: (values: unknown) => ({
			where: () => {
				state.updateCall = { table, values };
				return Promise.resolve([{ affectedRows: 1 }]);
			},
		}),
	}));
	db.delete = vi.fn((table) => ({
		where: (condition: unknown) => {
			state.deleteCall = { table, condition };
			return Promise.resolve([{ affectedRows: 1 }]);
		},
	}));
	return { ...schema, db };
});

import {
	createTemplate,
	deleteTemplate,
	updateTemplate,
} from "./ticket-templates";

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = ["admin.tickets.edit"];
	state.existing = [];
	state.insertCall = undefined;
	state.updateCall = undefined;
	state.deleteCall = undefined;
});

const validTemplate = {
	title: "Welcome",
	content: "Hello and welcome aboard!",
};

describe("createTemplate", () => {
	it("creates a template and returns its id", async () => {
		const res = await createTemplate(validTemplate);
		expect(res).toEqual({ ok: true, data: { id: 73 } });
		expect(state.insertCall.values).toMatchObject(validTemplate);
	});

	it("applies schema defaults (category and sortOrder)", async () => {
		const res = await createTemplate({
			title: "Refund",
			content: "We will process your refund",
		});
		expect(res.ok).toBe(true);
		expect(state.insertCall.values).toMatchObject({
			category: "general",
			sortOrder: 0,
		});
	});

	it("coerces a numeric sortOrder string", async () => {
		await createTemplate({ ...validTemplate, sortOrder: "5" });
		expect(state.insertCall.values).toMatchObject({ sortOrder: 5 });
	});

	it("rejects empty titles and content", async () => {
		expect(await createTemplate({ title: "", content: "x" })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
		expect(await createTemplate({ title: "T", content: "" })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
	});

	it("requires the tickets edit permission", async () => {
		state.allowed = [];
		expect(await createTemplate(validTemplate)).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});

describe("updateTemplate", () => {
	it("updates an existing template", async () => {
		state.existing = [{ id: 3 }];
		const res = await updateTemplate({ id: 3, title: "Renamed" });
		expect(res).toEqual({ ok: true, data: { id: 3 } });
		expect(state.updateCall.values).toMatchObject({ title: "Renamed" });
	});

	it("reports a missing template", async () => {
		state.existing = [];
		expect(await updateTemplate({ id: 99, title: "Ghost" })).toEqual({
			ok: false,
			error: "Template not found",
		});
		expect(state.updateCall).toBeUndefined();
	});

	it("rejects a non-positive id", async () => {
		expect(await updateTemplate({ id: 0, title: "X" })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
	});
});

describe("deleteTemplate", () => {
	it("deletes a template by id", async () => {
		const res = await deleteTemplate({ id: 10 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.deleteCall.condition).toBeDefined();
	});

	it("rejects a non-positive id", async () => {
		expect(await deleteTemplate({ id: -3 })).toMatchObject({
			ok: false,
			error: "Validation failed",
		});
	});

	it("requires the tickets edit permission", async () => {
		state.allowed = [];
		expect(await deleteTemplate({ id: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});
