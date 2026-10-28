// @ts-nocheck
import { describe, expect, it } from "vitest";
import { formatAuditValue, readAuditChanges } from "./audit-diff";
import { normalizeAuditFilters } from "./audit-filters";

describe("audit filter bounds", () => {
	it("normalizes pagination and rejects invalid calendar dates", () => {
		expect(
			normalizeAuditFilters({
				page: NaN,
				perPage: Infinity,
				from: "2026-02-30",
				to: "x",
			}),
		).toMatchObject({ page: 1, perPage: 20, from: "", to: "" });
		expect(normalizeAuditFilters({ page: -3, perPage: 1000 })).toMatchObject({
			page: 1,
			perPage: 100,
		});
	});
	it("caps strings and preserves exact actor/action and UTC day boundaries", () => {
		expect(
			normalizeAuditFilters({
				actor: " Alice ",
				action: " update ",
				from: "2026-09-09",
				to: "2026-09-09",
			}),
		).toMatchObject({
			actor: "Alice",
			action: "update",
			from: "2026-09-09",
			until: "2026-09-10",
		});
		expect(
			normalizeAuditFilters({ search: "x".repeat(500) }).search,
		).toHaveLength(191);
	});
});
describe("legacy audit diffs", () => {
	it.each(["null", "[]", "1", "bad JSON", '{"name":null}', '{"name":"value"}'])(
		"handles %s safely",
		(diff) => {
			expect(readAuditChanges(diff).invalid).toBe(true);
		},
	);
	it("keeps objects and explicit null distinct from absent values", () => {
		const result = readAuditChanges(
			'{"settings":{"from":{"enabled":false},"to":null},"added":{"to":3}}',
		);
		expect(result.changes).toHaveLength(2);
		expect(formatAuditValue(result.changes[0].from)).toContain(
			'"enabled": false',
		);
		expect(formatAuditValue(result.changes[0].to)).toBe("null");
		expect(formatAuditValue(result.changes[1].from)).toBe("∅");
	});
	it("shows create/delete snapshots when a legacy record has no diff", () => {
		expect(readAuditChanges(null, null, '{"name":"New"}').changes).toEqual([
			{ key: "name", from: undefined, to: "New" },
		]);
	});
	it("redacts historical sensitive nested fields before rendering", () => {
		expect(
			formatAuditValue(
				readAuditChanges('{"settings":{"from":{"password":"secret"},"to":{}}}')
					.changes[0].from,
			),
		).not.toContain("secret");
	});
});
