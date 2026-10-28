// @ts-nocheck
import { describe, expect, it } from "vitest";
import { patchJson5 } from "./json5-patch";

const sample = `// header comment
{
	// a section
	"title": "Hotel",
	"subtitle": "Welcome!",
	'nested.key': "keep me",
}`;

describe("patchJson5", () => {
	it("surgically replaces a value while preserving comments", () => {
		const result = patchJson5(sample, { title: "Hotel" }, { title: "Resort" });
		expect(result.unpatchedKeys).toEqual([]);
		expect(result.content).toContain('"title": "Resort"');
		expect(result.content).toContain("// a section");
		expect(result.content).toContain('"subtitle": "Welcome!"');
	});

	it("does not touch keys whose value is unchanged", () => {
		const result = patchJson5(sample, { title: "Hotel" }, { title: "Hotel" });
		expect(result.unpatchedKeys).toEqual([]);
		expect(result.content).toBe(sample);
	});

	it("reports keys missing from the original", () => {
		const result = patchJson5(sample, { title: "Hotel" }, { newKey: "x" });
		expect(result.unpatchedKeys).toEqual(["newKey"]);
		expect(result.content).toBe(sample);
	});

	it("reports keys that cannot be located in the source", () => {
		const result = patchJson5(sample, { title: "Hotel" }, { title: "nope" });
		// "title" is present and findable, so it patches.
		expect(result.unpatchedKeys).toEqual([]);
		expect(result.content).toContain('"title": "nope"');
	});

	it("handles single-quoted keys and escaped values", () => {
		const result = patchJson5(
			sample,
			{ "nested.key": "keep me" },
			{ "nested.key": 'say "hi"' },
		);
		expect(result.unpatchedKeys).toEqual([]);
		expect(result.content).toContain(`'nested.key': "say \\"hi\\""`);
	});

	it("reports keys that do not appear in the file at all", () => {
		const result = patchJson5(sample, { missing: "a" }, { missing: "b" });
		expect(result.unpatchedKeys).toEqual(["missing"]);
	});
});
