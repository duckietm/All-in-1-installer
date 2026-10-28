// @ts-nocheck
import { describe, expect, it } from "vitest";
import { resolveConnectionLimit } from "./db-pool";

describe("resolveConnectionLimit", () => {
	it("caps the pool during production build phases", () => {
		expect(resolveConnectionLimit(40, "phase-production-build")).toBe(5);
		expect(resolveConnectionLimit(40, "phase-production-compile")).toBe(5);
		expect(resolveConnectionLimit(3, "phase-production-build")).toBe(3);
	});

	it("keeps the configured pool outside build", () => {
		expect(resolveConnectionLimit(40, undefined)).toBe(40);
		expect(resolveConnectionLimit(40, "phase-development-server")).toBe(40);
	});
});
