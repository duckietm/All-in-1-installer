import { describe, expect, it } from "vitest";
import { databaseUserId, sessionUserId } from "@/lib/auth/session-user";

describe("sessionUserId", () => {
	it("returns a positive safe integer from a valid session id", () => {
		expect(sessionUserId("42")).toBe(42);
	});

	it.each([
		undefined,
		null,
		"",
		"0",
		"-1",
		"1.5",
		"abc",
		Number.MAX_SAFE_INTEGER + 1,
	])("rejects invalid session id %s", (value) => {
		expect(sessionUserId(value)).toBeNull();
	});
});

describe("databaseUserId", () => {
	it("converts a safe positive database id", () => {
		expect(databaseUserId(42n)).toBe(42);
	});

	it.each([0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
		"rejects unsafe database id %s",
		(value) => {
			expect(databaseUserId(value)).toBeNull();
		},
	);
});
