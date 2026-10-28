import { describe, expect, it } from "vitest";

import { updateRoomSchema } from "./room";

describe("updateRoomSchema", () => {
	it("accepts valid room update", () => {
		const result = updateRoomSchema.safeParse({
			name: "My Room",
			description: "A cool room",
			state: "open",
			usersMax: 20,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.name).toBe("My Room");
			expect(result.data.state).toBe("open");
		}
	});

	it("accepts partial updates", () => {
		const result = updateRoomSchema.safeParse({ state: "locked" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.state).toBe("locked");
			expect(result.data.name).toBeUndefined();
		}
	});

	it("rejects name too long", () => {
		expect(updateRoomSchema.safeParse({ name: "a".repeat(61) }).success).toBe(
			false,
		);
	});

	it("rejects description too long", () => {
		expect(
			updateRoomSchema.safeParse({ description: "b".repeat(513) }).success,
		).toBe(false);
	});

	it("rejects invalid state", () => {
		expect(updateRoomSchema.safeParse({ state: "banana" }).success).toBe(false);
	});

	it("rejects usersMax below 1", () => {
		expect(updateRoomSchema.safeParse({ usersMax: 0 }).success).toBe(false);
	});

	it("rejects usersMax above 100", () => {
		expect(updateRoomSchema.safeParse({ usersMax: 101 }).success).toBe(false);
	});
});
