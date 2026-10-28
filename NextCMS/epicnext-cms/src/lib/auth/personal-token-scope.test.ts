// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	personalTokenScope,
	USER_TOKENABLE_TYPE,
} from "./personal-token-scope";

describe("personal-token-scope", () => {
	it("exports USER_TOKENABLE_TYPE constant", () => {
		expect(USER_TOKENABLE_TYPE).toBe("App\\Models\\User");
	});

	it("returns correct scope with BigInt", () => {
		const r = personalTokenScope(42);
		expect(r.tokenableId).toBe(BigInt(42));
		expect(r.tokenableType).toBe("App\\Models\\User");
	});
});
