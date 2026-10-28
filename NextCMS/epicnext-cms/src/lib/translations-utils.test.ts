// @ts-nocheck
import { describe, expect, it } from "vitest";
import { flattenObject, unflattenObject } from "./translations-utils";

describe("flattenObject", () => {
	it("flattens nested objects into dotted keys", () => {
		const flat = flattenObject({ a: { b: { c: "x" } }, d: "y" });
		expect(flat).toEqual({ "a.b.c": "x", d: "y" });
	});

	it("stringifies non-object values", () => {
		expect(flattenObject({ n: 5, b: true, nil: null })).toEqual({
			n: "5",
			b: "true",
			nil: "",
		});
	});

	it("keeps arrays as-is via String()", () => {
		expect(flattenObject({ list: ["a", "b"] })).toEqual({ list: "a,b" });
	});

	it("honours an explicit prefix", () => {
		expect(flattenObject({ a: 1 }, "root")).toEqual({ "root.a": "1" });
	});
});

describe("unflattenObject", () => {
	it("rebuilds nested objects from dotted keys", () => {
		expect(unflattenObject({ "a.b.c": "x", d: "y" })).toEqual({
			a: { b: { c: "x" } },
			d: "y",
		});
	});

	it("creates intermediate objects as needed", () => {
		expect(unflattenObject({ "x.y": "1", "x.z": "2" })).toEqual({
			x: { y: "1", z: "2" },
		});
	});

	it("round-trips with flattenObject", () => {
		const original = { menu: { home: "Home", items: { a: "A" } }, footer: "F" };
		expect(unflattenObject(flattenObject(original))).toEqual(original);
	});
});
