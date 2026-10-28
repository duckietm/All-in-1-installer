import { describe, expect, it } from "vitest";
import { translateItemsSchema } from "@/lib/validators/catalog";

describe("translateItemsSchema", () => {
	it("accepts a valid payload", () => {
		const parsed = translateItemsSchema.safeParse({
			items: [{ id: 1, publicName: "Chair", description: "A chair" }],
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects more than 500 items", () => {
		const items = Array.from({ length: 501 }, (_, i) => ({
			id: i + 1,
			publicName: `Item ${i + 1}`,
		}));
		const parsed = translateItemsSchema.safeParse({ items });
		expect(parsed.success).toBe(false);
	});

	it("rejects oversized public names", () => {
		const parsed = translateItemsSchema.safeParse({
			items: [{ id: 1, publicName: "x".repeat(256) }],
		});
		expect(parsed.success).toBe(false);
	});
});
