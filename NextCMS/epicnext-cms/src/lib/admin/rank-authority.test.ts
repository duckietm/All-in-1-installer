import { describe, expect, it } from "vitest";
import { resolveAuthorizationState } from "@/lib/admin/rank-authority";

function db(
	user: { id: number; username: string; rank: number } | null,
	highest: number | null,
) {
	return {
		user: { findUnique: async () => user },
		highestRank: async () => highest,
	};
}

describe("resolveAuthorizationState", () => {
	it("uses current database rank and highest rank 2000", async () => {
		await expect(
			resolveAuthorizationState(
				7,
				db({ id: 7, username: "root", rank: 2000 }, 2000),
			),
		).resolves.toEqual({
			actor: { id: 7, username: "root", rank: 2000 },
			highestRank: 2000,
		});
	});
	it("returns null for a deleted user", async () =>
		expect(resolveAuthorizationState(7, db(null, 2000))).resolves.toBeNull());
	it("fails closed when there are no ranks", async () =>
		expect(
			resolveAuthorizationState(
				7,
				db({ id: 7, username: "root", rank: 1 }, null),
			),
		).resolves.toEqual({
			actor: { id: 7, username: "root", rank: 1 },
			highestRank: null,
		}));
});
