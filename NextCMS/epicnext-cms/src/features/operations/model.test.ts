// @ts-nocheck
import { expect, it } from "vitest";
import { operationHash, retryDelay, validateOperation } from "./model";

it("hashes equivalent object payloads equally without ignoring array order", () => {
	expect(operationHash({ b: 2, a: { y: 1, x: 0 } })).toBe(
		operationHash({ a: { x: 0, y: 1 }, b: 2 }),
	);
	expect(operationHash([1, 2])).not.toBe(operationHash([2, 1]));
});
it("rejects unsupported or oversized input rather than hashing ambiguous values", () => {
	expect(() => operationHash({ amount: NaN })).toThrow();
	expect(() => operationHash({ value: undefined })).toThrow();
	expect(() => operationHash("x".repeat(100000))).toThrow();
});
it("validates actor and request identity before database access", () => {
	const valid = {
		actorId: 1,
		kind: "catalog.bulk.apply",
		key: "123e4567-e89b-42d3-a456-426614174000",
		input: {},
	};
	expect(() => validateOperation(valid)).not.toThrow();
	expect(() => validateOperation({ ...valid, actorId: 0 })).toThrow();
	expect(() => validateOperation({ ...valid, key: "shared" })).toThrow();
	expect(() => validateOperation({ ...valid, kind: "bad kind" })).toThrow();
});
it("backs off boundedly for repeated delivery failures", () => {
	expect(retryDelay(1)).toBe(60);
	expect(retryDelay(2)).toBe(120);
	expect(retryDelay(20)).toBe(3600);
});
