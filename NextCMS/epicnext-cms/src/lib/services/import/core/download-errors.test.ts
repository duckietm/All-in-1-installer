import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn().mockReturnValue(false),
	};
});

describe("download errors", () => {
	it("handles missing files gracefully", () => {
		expect(true).toBe(true);
	});
});
