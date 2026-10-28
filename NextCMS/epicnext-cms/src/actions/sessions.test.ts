// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	signOut: vi.fn(async () => undefined),
	invalidateJwtVersionCache: vi.fn(async () => undefined),
	personalTokenScope: vi.fn(() => ({
		tokenableId: 5n,
		tokenableType: "App\\Models\\User",
	})),
	logger: { warn: vi.fn() },
	update: vi.fn(async () => [{ affectedRows: 1 }]),
	del: vi.fn(async () => [{ affectedRows: 1 }]),
	failUpdate: false,
	failDelete: false,
}));

vi.mock("@/lib/auth", () => ({
	auth: state.auth,
	signOut: state.signOut,
}));
vi.mock("@/lib/auth/jwt-version-cache", () => ({
	invalidateJwtVersionCache: state.invalidateJwtVersionCache,
}));
vi.mock("@/lib/auth/personal-token-scope", () => ({
	personalTokenScope: state.personalTokenScope,
}));
vi.mock("@/lib/logger", () => ({ logger: state.logger }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) =>
						state.failUpdate
							? Promise.reject(new Error("update down"))
							: state.update(table, values, where),
				}),
			}),
			delete: (table: unknown) => ({
				where: (where: unknown) =>
					state.failDelete
						? Promise.reject(new Error("delete down"))
						: state.del(table, where),
			}),
		},
	};
});

import { PersonalAccessTokens, User } from "@/lib/db";
import { signOutAndRevokeTicket, signOutEverywhere } from "./sessions";

describe("signOutEverywhere", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.failUpdate = false;
		state.failDelete = false;
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.del.mockResolvedValue([{ affectedRows: 1 }]);
		state.signOut.mockResolvedValue(undefined);
	});

	it("bumps the JWT version, clears the ticket, deletes tokens and signs out everywhere", async () => {
		await signOutEverywhere();
		expect(state.update).toHaveBeenCalledTimes(1);
		expect(state.update.mock.calls[0][0]).toBe(User);
		expect(state.update.mock.calls[0][1]).toMatchObject({
			authTicket: "",
			websiteJwtVersion: expect.anything(),
		});
		expect(state.invalidateJwtVersionCache).toHaveBeenCalledWith(5);
		expect(state.del).toHaveBeenCalledTimes(1);
		expect(state.del.mock.calls[0][0]).toBe(PersonalAccessTokens);
		expect(state.signOut).toHaveBeenCalledWith({
			redirectTo: "/login?signedOutAll=1",
		});
		expect(state.logger.warn).not.toHaveBeenCalled();
	});

	it("only signs out (to /login) when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await signOutEverywhere();
		expect(state.update).not.toHaveBeenCalled();
		expect(state.del).not.toHaveBeenCalled();
		expect(state.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
	});

	it("rejects unusable session ids the same way", async () => {
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await signOutEverywhere();
		state.auth.mockResolvedValue({ user: { id: "abc" } });
		await signOutEverywhere();
		expect(state.update).not.toHaveBeenCalled();
		expect(state.signOut).toHaveBeenCalledTimes(2);
	});

	it("warns and keeps going when the user update fails", async () => {
		state.failUpdate = true;
		await signOutEverywhere();
		expect(state.logger.warn).toHaveBeenCalledWith(
			"Failed to bump JWT version during sign-out-everywhere",
			expect.objectContaining({ userId: 5 }),
		);
		expect(state.del).toHaveBeenCalledTimes(1);
		expect(state.signOut).toHaveBeenCalled();
	});

	it("warns and keeps going when token revocation fails", async () => {
		state.failDelete = true;
		state.failUpdate = false;
		await signOutEverywhere();
		expect(state.logger.warn).toHaveBeenCalledWith(
			"Failed to revoke personal access tokens during sign-out-everywhere",
			expect.objectContaining({ userId: 5 }),
		);
		expect(state.signOut).toHaveBeenCalled();
	});
});

describe("signOutAndRevokeTicket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.failUpdate = false;
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.signOut.mockResolvedValue(undefined);
	});

	it("clears the SSO ticket and signs out to /", async () => {
		await signOutAndRevokeTicket();
		expect(state.update).toHaveBeenCalledTimes(1);
		expect(state.update.mock.calls[0][0]).toBe(User);
		expect(state.update.mock.calls[0][1]).toEqual({ authTicket: "" });
		expect(state.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
	});

	it("still signs out when unauthenticated but skips the ticket write", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await signOutAndRevokeTicket();
		expect(state.update).not.toHaveBeenCalled();
		expect(state.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
	});

	it("warns but still signs out when the ticket revoke fails", async () => {
		state.failUpdate = true;
		await signOutAndRevokeTicket();
		expect(state.logger.warn).toHaveBeenCalledWith(
			"Failed to revoke SSO ticket during sign out",
			expect.objectContaining({ userId: 5 }),
		);
		expect(state.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
	});
});
