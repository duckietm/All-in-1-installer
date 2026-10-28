import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("authorization source contract", () => {
	it("contains no fixed numeric rank threshold in central authorization files", () => {
		for (const file of [
			"src/lib/permissions.ts",
			"src/lib/proxy-access.ts",
			"src/lib/admin/guard.ts",
		]) {
			const source = readFileSync(file, "utf8");
			expect(source, file).not.toMatch(/rank\s*[<>]=?\s*\d+/i);
		}
	});
});
