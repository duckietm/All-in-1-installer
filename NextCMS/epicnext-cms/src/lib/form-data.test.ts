// @ts-nocheck
import { describe, expect, it } from "vitest";
import { formPositiveBigInt } from "@/lib/form-data";

describe("formPositiveBigInt", () => {
	it("parses a positive identifier from FormData", () => {
		const formData = new FormData();
		formData.set("id", "42");

		expect(formPositiveBigInt(formData, "id")).toBe(42n);
	});

	it.each(["", "0", "-1", "1.5", "invalid"])(
		"rejects invalid identifier %s",
		(value) => {
			const formData = new FormData();
			formData.set("id", value);

			expect(formPositiveBigInt(formData, "id")).toBeNull();
		},
	);
});
