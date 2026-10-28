import { describe, expect, it } from "vitest";

import { createEventSchema, eventTypeSchema, updateEventSchema } from "./event";

describe("eventTypeSchema", () => {
	it("accepts valid type", () => {
		const result = eventTypeSchema.safeParse({
			name: "Concert",
			slug: "concert",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.color).toBe("#3b82f6");
			expect(result.data.isActive).toBe(1);
		}
	});

	it("rejects empty name", () => {
		expect(eventTypeSchema.safeParse({ name: "", slug: "test" }).success).toBe(
			false,
		);
		expect(eventTypeSchema.safeParse({ slug: "test" }).success).toBe(false);
	});

	it("rejects slug with uppercase", () => {
		const result = eventTypeSchema.safeParse({
			name: "Test",
			slug: "TestEvent",
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].message).toBe(
			"Slug must be lowercase with hyphens",
		);
	});

	it("rejects slug with spaces", () => {
		expect(
			eventTypeSchema.safeParse({
				name: "Test",
				slug: "test event",
			}).success,
		).toBe(false);
	});
});

describe("createEventSchema", () => {
	it("accepts valid event", () => {
		const result = createEventSchema.safeParse({
			title: "My Event",
			description: "Fun times",
			typeId: 1,
			startsAt: "2025-07-25T10:00:00Z",
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing description", () => {
		const result = createEventSchema.safeParse({
			title: "No description event",
			typeId: 1,
			startsAt: "2025-07-25T10:00:00Z",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing title", () => {
		expect(
			createEventSchema.safeParse({
				title: "",
				description: "Has desc",
				typeId: 1,
				startsAt: "2025-07-25T10:00:00Z",
			}).success,
		).toBe(false);
	});

	it("defaults status to draft", () => {
		const result = createEventSchema.safeParse({
			title: "Draft Event",
			description: "Not published yet",
			typeId: 1,
			startsAt: "2025-07-25T10:00:00Z",
		});
		if (result.success) {
			expect(result.data.status).toBe("draft");
		}
	});

	it("defaults isRecurring to 0", () => {
		const result = createEventSchema.safeParse({
			title: "Single Event",
			description: "One time",
			typeId: 1,
			startsAt: "2025-07-25T10:00:00Z",
		});
		if (result.success) {
			expect(result.data.isRecurring).toBe(0);
		}
	});
});

it("preserves omitted status and recurrence on partial event updates", () => {
	expect(updateEventSchema.parse({ title: "Changed" })).toEqual({
		title: "Changed",
	});
});
it("rejects a null event start instead of converting it to the Unix epoch", () => {
	expect(
		createEventSchema.safeParse({
			title: "Event",
			description: "Details",
			typeId: 1,
			startsAt: null,
			status: "published",
		}).success,
	).toBe(false);
});

it("distinguishes an omitted image from explicit image removal", () => {
	expect(updateEventSchema.parse({ title: "Changed" })).not.toHaveProperty(
		"image",
	);
	expect(updateEventSchema.parse({ image: "" })).toEqual({ image: null });
});
