// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import {
	createMockAuth,
	createMockDb,
	createMockLogStaffActivity,
	createMockRcon,
	createMockRevalidatePath,
} from "./test-helpers";

describe("test-helpers", () => {
	it("createMockDb returns vi.fn-backed query methods", () => {
		const db = createMockDb();
		expect(Object.keys(db).sort()).toEqual([
			"delete",
			"insert",
			"select",
			"update",
		]);
		for (const method of ["insert", "update", "delete", "select"]) {
			expect(db[method as keyof typeof db]).toBeTypeOf("function");
			expect(vi.isMockFunction(db[method as keyof typeof db])).toBe(true);
		}
	});

	it("createMockAuth returns next-auth-like object", () => {
		const auth = createMockAuth();
		expect(auth).toEqual({
			auth: expect.any(Function),
			handlers: {},
			signOut: expect.any(Function),
		});
		expect(vi.isMockFunction(auth.auth)).toBe(true);
		expect(vi.isMockFunction(auth.signOut)).toBe(true);
	});

	it("createMockRcon exposes the RCON command surface", () => {
		const rcon = createMockRcon();
		expect(Object.keys(rcon).sort()).toEqual([
			"alertUser",
			"disconnectUser",
			"giveBadge",
			"giveCredits",
			"muteUser",
			"removeBadge",
			"unmuteUser",
		]);
		for (const fn of Object.values(rcon)) {
			expect(vi.isMockFunction(fn)).toBe(true);
		}
	});

	it("createMockLogStaffActivity and createMockRevalidatePath return fresh mocks", () => {
		expect(vi.isMockFunction(createMockLogStaffActivity())).toBe(true);
		expect(vi.isMockFunction(createMockRevalidatePath())).toBe(true);
		const a = createMockRevalidatePath();
		const b = createMockRevalidatePath();
		expect(a).not.toBe(b);
	});
});
