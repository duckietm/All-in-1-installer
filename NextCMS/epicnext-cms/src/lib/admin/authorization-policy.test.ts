import { describe, expect, it } from "vitest";
import {
	decideAuthorization,
	isDynamicSuperAdmin,
} from "./authorization-policy";

describe("isDynamicSuperAdmin", () => {
	it("returns true when rank equals the highest rank", () => {
		expect(isDynamicSuperAdmin(7, 7)).toBe(true);
	});
	it("returns false for non-highest ranks", () => {
		expect(isDynamicSuperAdmin(6, 7)).toBe(false);
	});
	it("returns false when highestRank is null or invalid", () => {
		expect(isDynamicSuperAdmin(7, null)).toBe(false);
		expect(isDynamicSuperAdmin(0, 7)).toBe(false);
		expect(isDynamicSuperAdmin(-1, 7)).toBe(false);
		expect(isDynamicSuperAdmin(1.5, 1.5)).toBe(false);
	});
});

describe("decideAuthorization", () => {
	const actor = { id: 1, username: "staff", rank: 5 };
	const base = { actor, highestRank: 7, hasPermission: false };

	it("allows super admins regardless of permission", () => {
		const decision = decideAuthorization({
			...base,
			actor: { ...actor, rank: 7 },
			hasPermission: false,
		});
		expect(decision).toEqual({ allowed: true, superAdmin: true });
	});

	it("denies invalid ranks", () => {
		expect(
			decideAuthorization({
				...base,
				actor: { ...actor, rank: 0 },
			}),
		).toEqual({ allowed: false, reason: "invalid_rank" });
	});

	it("denies when there are no ranks configured", () => {
		expect(decideAuthorization({ ...base, highestRank: null })).toEqual({
			allowed: false,
			reason: "no_ranks",
		});
	});

	it("allows when permission is granted", () => {
		expect(decideAuthorization({ ...base, hasPermission: true })).toEqual({
			allowed: true,
			superAdmin: false,
		});
	});

	it("allows when no permission is required", () => {
		const decision = decideAuthorization({ ...base, permission: undefined });
		expect(decision).toEqual({ allowed: true, superAdmin: false });
	});

	it("denies when permission is missing", () => {
		const decision = decideAuthorization({
			...base,
			permission: "users.manage",
		});
		expect(decision).toEqual({ allowed: false, reason: "permission_denied" });
	});
});
