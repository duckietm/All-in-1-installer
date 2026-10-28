// @ts-nocheck
import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
	const d = new Date("2026-07-18T18:30:45.123Z");

	it("formats as datetime by default", () => {
		expect(formatDate(d)).toBe("2026-07-18 18:30");
	});

	it("formats as date only", () => {
		expect(formatDate(d, "date")).toBe("2026-07-18");
	});

	it("formats with seconds", () => {
		expect(formatDate(d, "datetime-seconds")).toBe("2026-07-18 18:30:45");
	});

	it("returns fallback for null/undefined", () => {
		expect(formatDate(null)).toBe("—");
		expect(formatDate(undefined)).toBe("—");
		expect(formatDate(null, "date")).toBe("");
		expect(formatDate(undefined, "datetime", "N/A")).toBe("N/A");
	});
});
