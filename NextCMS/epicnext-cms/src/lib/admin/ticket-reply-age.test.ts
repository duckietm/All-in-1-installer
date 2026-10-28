import { describe, expect, it } from "vitest";
import { ticketReplyAge } from "./ticket-reply-age";

describe("ticket reply age", () => {
	it("measures elapsed minutes, including day boundaries", () => {
		expect(
			ticketReplyAge(
				"2026-09-10T12:00:00Z",
				Date.parse("2026-09-11T13:30:00Z"),
			),
		).toBe(1530);
	});
	it("does not report negative or invalid ages", () => {
		expect(ticketReplyAge(new Date(2000), 1000)).toBe(0);
		expect(ticketReplyAge("invalid")).toBeNull();
		expect(ticketReplyAge(null)).toBeNull();
	});
});
