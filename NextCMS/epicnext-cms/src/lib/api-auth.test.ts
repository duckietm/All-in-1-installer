// @ts-nocheck
import { describe, expect, it } from "vitest";
import { personalTokenScope } from "@/lib/auth/personal-token-scope";

describe("personalTokenScope", () => {
	it("scopes token operations to the user model and owner id", () => {
		expect(personalTokenScope(42)).toEqual({
			tokenableId: 42n,
			tokenableType: "App\\Models\\User",
		});
	});
});
