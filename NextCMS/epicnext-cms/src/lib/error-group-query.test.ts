// @ts-nocheck
import { expect, it } from "vitest";
import { queryErrorGroups } from "./error-group-query";
import { createErrorRecord } from "./error-monitor";

const now = Date.parse("2026-09-09T12:00:00Z");
const base = createErrorRecord("server", "save", "failed");
it("filters occurrences by exact release before aggregating", () => {
	const old = { ...base, release: "old", at: "2026-09-09T10:00:00Z" };
	const fresh = { ...base, release: "new", at: "2026-09-09T11:00:00Z" };
	expect(
		queryErrorGroups([old, fresh], { release: "old" }, now)[0].events,
	).toEqual([old]);
});
it("filters finite recent windows and sorts frequent groups first", () => {
	const a = { ...base, fingerprint: "a", at: "2026-09-09T10:00:00Z" };
	const b = { ...a, fingerprint: "b", at: "2026-09-09T11:00:00Z" };
	const old = { ...a, at: "2026-09-01T10:00:00Z" };
	expect(
		queryErrorGroups(
			[b, a, a, old],
			{ period: "24h", sort: "frequency" },
			now,
		).map((g) => [g.fingerprint, g.events.length]),
	).toEqual([
		["a", 2],
		["b", 1],
	]);
});
it("uses latest group resolution while filtering historical releases", () => {
	const old = {
		...base,
		release: "old",
		at: "2026-09-08T10:00:00Z",
		resolved: false,
	};
	const latest = {
		...base,
		release: "new",
		at: "2026-09-09T11:00:00Z",
		resolved: true,
	};
	expect(
		queryErrorGroups([old, latest], { release: "old", status: "open" }, now),
	).toHaveLength(0);
});
