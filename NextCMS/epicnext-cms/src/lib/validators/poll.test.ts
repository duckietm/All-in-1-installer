import { describe, expect, it } from "vitest";

import {
	createPollSchema,
	pollQuestionSchema,
	pollVoteSchema,
	updatePollSchema,
	voteOnPollSchema,
} from "./poll";

describe("createPollSchema", () => {
	it("accepts valid input", () => {
		const result = createPollSchema.safeParse({
			title: "My Poll",
			description: "A test poll",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.title).toBe("My Poll");
			expect(result.data.status).toBe("draft");
			expect(result.data.showResults).toBe(1);
		}
	});

	it("rejects empty title", () => {
		expect(createPollSchema.safeParse({ title: "" }).success).toBe(false);
		expect(createPollSchema.safeParse({}).success).toBe(false);
	});
});

describe("createPollSchema defaults", () => {
	it("defaults status to draft", () => {
		const result = createPollSchema.safeParse({ title: "Test" });
		if (result.success) expect(result.data.status).toBe("draft");
	});

	it("defaults showResults to 1", () => {
		const result = createPollSchema.safeParse({ title: "Test" });
		if (result.success) expect(result.data.showResults).toBe(1);
	});

	it("defaults multipleChoice to 0", () => {
		const result = createPollSchema.safeParse({ title: "Test" });
		if (result.success) expect(result.data.multipleChoice).toBe(0);
	});
});

describe("pollQuestionSchema", () => {
	it("accepts valid question", () => {
		const result = pollQuestionSchema.safeParse({
			pollId: 1,
			question: "What is your favorite color?",
			options: "Red|Blue|Green",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.type).toBe("single");
			expect(result.data.sortOrder).toBe(0);
		}
	});

	it("rejects empty question", () => {
		expect(
			pollQuestionSchema.safeParse({ pollId: 1, question: "", options: "Red" })
				.success,
		).toBe(false);
	});

	it("rejects missing pollId", () => {
		expect(
			pollQuestionSchema.safeParse({ question: "Test?", options: "A" }).success,
		).toBe(false);
	});
});

describe("pollVoteSchema", () => {
	it("accepts valid vote", () => {
		const result = pollVoteSchema.safeParse({
			questionId: 5,
			answer: "Option A",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty answer", () => {
		expect(
			pollVoteSchema.safeParse({ questionId: 5, answer: "" }).success,
		).toBe(false);
	});

	it("rejects non-positive questionId", () => {
		expect(
			pollVoteSchema.safeParse({ questionId: 0, answer: "x" }).success,
		).toBe(false);
	});
});

describe("voteOnPollSchema", () => {
	it("accepts valid vote batch", () => {
		const result = voteOnPollSchema.safeParse({
			pollId: 1,
			votes: [
				{ questionId: 1, answer: "Yes" },
				{ questionId: 2, answer: "No" },
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty votes array", () => {
		expect(voteOnPollSchema.safeParse({ pollId: 1, votes: [] }).success).toBe(
			false,
		);
	});

	it("rejects too many votes (more than 50)", () => {
		const votes = Array.from({ length: 51 }, (_, i) => ({
			questionId: i + 1,
			answer: `Answer ${i + 1}`,
		}));
		expect(voteOnPollSchema.safeParse({ pollId: 1, votes }).success).toBe(
			false,
		);
	});
});

describe("updatePollSchema", () => {
	it("is partial (all fields optional)", () => {
		const result = updatePollSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("accepts subset of fields", () => {
		const result = updatePollSchema.safeParse({ title: "New Title" });
		if (result.success) expect(result.data.title).toBe("New Title");
	});
});
