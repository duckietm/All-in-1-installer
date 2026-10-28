// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	DRAFT_TTL,
	decodeRecovery,
	encodeRecovery,
	recoveryKey,
} from "./form-recovery";

const article = {
	title: "Draft",
	slug: "draft",
	image: "",
	shortStory: "",
	fullStory: "<p>Unsaved</p>",
	status: "draft",
	publishAt: "",
};
describe("form recovery storage contract", () => {
	it("isolates account, form and record, including separator characters", () => {
		expect(
			new Set([
				recoveryKey("1", "article", "new"),
				recoveryKey("2", "article", "new"),
				recoveryKey("1", "event", "new"),
				recoveryKey("1", "article", "2"),
				recoveryKey("1:article", "article", "new"),
			]).size,
		).toBe(5);
	});
	it("round trips unfinished content and only retains allowlisted fields", () => {
		const raw = encodeRecovery(
			"article",
			{
				...article,
				password: "private",
				accessToken: "secret",
				baseToken: "version",
			},
			1000,
		);
		expect(decodeRecovery("article", raw, 1001).payload).toEqual(article);
		expect(raw).not.toMatch(/private|secret|baseToken/);
	});
	it.each([
		"{",
		JSON.stringify({ version: 2, savedAt: 1000, payload: article }),
		JSON.stringify({
			version: 1,
			savedAt: 1000,
			payload: { ...article, title: 42 },
		}),
	])("rejects malformed or unsupported records", (raw) => {
		expect(() => decodeRecovery("article", raw, 1001)).toThrow();
	});
	it("expires old records and rejects future timestamps", () => {
		expect(() =>
			decodeRecovery(
				"article",
				encodeRecovery("article", article, 1000),
				1001 + DRAFT_TTL,
			),
		).toThrow();
		expect(() =>
			decodeRecovery(
				"article",
				encodeRecovery("article", article, 100000),
				1000,
			),
		).toThrow();
	});
	it("limits content size", () => {
		expect(() =>
			encodeRecovery("article", { ...article, fullStory: "x".repeat(500001) }),
		).toThrow();
	});
	it("preserves optional event dates without coercing absent dates", () => {
		const event = {
			title: "",
			description: "",
			typeId: 1,
			status: "draft",
			isRecurring: 0,
			startsAt: "2030-01-01T12:00:00.000Z",
			endsAt: null,
			roomId: "",
		};
		expect(
			decodeRecovery("event", encodeRecovery("event", event)).payload,
		).toEqual(event);
	});
});
