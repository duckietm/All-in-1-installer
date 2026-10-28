import { describe, expect, it } from "vitest";

import {
	banUserSchema,
	createUserSchema,
	giveBadgeSchema,
	updateUserSchema,
} from "./user";

describe("createUserSchema", () => {
	it("accepts valid user", () => {
		const result = createUserSchema.safeParse({
			username: "TestUser",
			mail: "test@example.com",
			password: "secret123456",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.rank).toBe(1);
			expect(result.data.motto).toBe("");
		}
	});

	it("rejects short username (< 3 chars)", () => {
		expect(
			createUserSchema.safeParse({
				username: "ab",
				mail: "test@example.com",
				password: "secret123456",
			}).success,
		).toBe(false);
	});

	it("rejects long username (> 20 chars)", () => {
		expect(
			createUserSchema.safeParse({
				username: "a".repeat(21),
				mail: "test@example.com",
				password: "secret123456",
			}).success,
		).toBe(false);
	});

	it("rejects invalid username characters", () => {
		expect(
			createUserSchema.safeParse({
				username: "user@name",
				mail: "test@example.com",
				password: "secret123456",
			}).success,
		).toBe(false);
	});

	it("rejects invalid email", () => {
		expect(
			createUserSchema.safeParse({
				username: "TestUser",
				mail: "not-an-email",
				password: "secret123456",
			}).success,
		).toBe(false);
	});

	it("rejects short password (< 6 chars)", () => {
		expect(
			createUserSchema.safeParse({
				username: "TestUser",
				mail: "test@example.com",
				password: "12345",
			}).success,
		).toBe(false);
	});
});

describe("updateUserSchema", () => {
	it("is partial", () => {
		expect(updateUserSchema.safeParse({}).success).toBe(true);
	});

	it("accepts username update", () => {
		const result = updateUserSchema.safeParse({
			username: "NewName",
		});
		if (result.success) expect(result.data.username).toBe("NewName");
	});

	it("rejects rank out of range", () => {
		expect(updateUserSchema.safeParse({ rank: 8 }).success).toBe(false);
	});
});

describe("banUserSchema", () => {
	it("accepts valid ban", () => {
		const result = banUserSchema.safeParse({
			userId: 1,
			reason: "Spamming",
			duration: 24,
			type: "account",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.type).toBe("account");
	});

	it("defaults type to account", () => {
		const result = banUserSchema.safeParse({
			userId: 1,
			reason: "Spamming",
			duration: 0,
		});
		if (result.success) expect(result.data.type).toBe("account");
	});

	it("rejects empty reason", () => {
		expect(
			banUserSchema.safeParse({ userId: 1, reason: "", duration: 1 }).success,
		).toBe(false);
	});

	it("rejects negative duration", () => {
		expect(
			banUserSchema.safeParse({ userId: 1, reason: "Bad", duration: -1 })
				.success,
		).toBe(false);
	});
});

describe("giveBadgeSchema", () => {
	it("accepts valid badge", () => {
		const result = giveBadgeSchema.safeParse({
			userId: 1,
			badgeCode: "BADGE01",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty badge code", () => {
		expect(
			giveBadgeSchema.safeParse({ userId: 1, badgeCode: "" }).success,
		).toBe(false);
	});
});
