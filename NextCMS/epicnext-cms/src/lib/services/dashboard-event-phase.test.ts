// @ts-nocheck
import { describe, expect, it } from "vitest";
import { getDashboardEventPhase } from "./dashboard-event-phase";

const now = new Date("2026-09-09T12:00:00Z");
const event = (
	startsAt: string,
	endsAt: string | null = null,
	status = "published",
) => ({
	startsAt: new Date(startsAt),
	endsAt: endsAt ? new Date(endsAt) : null,
	status,
});

describe("dashboard event timing", () => {
	it("shows a future published event without requiring an end", () => {
		expect(getDashboardEventPhase(event("2026-09-09T13:00:00Z"), now)).toBe(
			"upcoming",
		);
	});
	it("marks the start boundary and known duration as ongoing", () => {
		expect(
			getDashboardEventPhase(
				event("2026-09-09T12:00:00Z", "2026-09-09T13:00:00Z"),
				now,
			),
		).toBe("ongoing");
	});
	it("excludes ended events including the exact end boundary", () => {
		expect(
			getDashboardEventPhase(
				event("2026-09-09T11:00:00Z", "2026-09-09T12:00:00Z"),
				now,
			),
		).toBeNull();
	});
	it("does not invent a duration for old events without an end", () => {
		expect(
			getDashboardEventPhase(event("2026-09-08T12:00:00Z"), now),
		).toBeNull();
	});
	it.each(["draft", "cancelled", "completed"])(
		"excludes %s events",
		(status) => {
			expect(
				getDashboardEventPhase(
					event("2026-09-09T13:00:00Z", null, status),
					now,
				),
			).toBeNull();
		},
	);
});
