// @ts-nocheck
import { describe, expect, it } from "vitest";
import { generateRequestId } from "./logger";

describe("generateRequestId", () => {
	it("produces a non-empty string", () => {
		const id = generateRequestId();
		expect(id).toBeTruthy();
		expect(typeof id).toBe("string");
	});

	it("produces unique values on successive calls", () => {
		const a = generateRequestId();
		const b = generateRequestId();
		expect(a).not.toBe(b);
	});
});
