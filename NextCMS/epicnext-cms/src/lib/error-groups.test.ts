// @ts-nocheck
import { expect, it } from "vitest";
import { errorOperationLink, summarizeErrorGroup } from "./error-groups";
import { createErrorRecord } from "./error-monitor";

it("counts retained occurrences and identified users across releases without trusting browser identities", () => {
	const base = createErrorRecord("server", "test", "failed", { userId: 12 });
	const first = { ...base, at: "2026-09-08T10:00:00Z", release: "a" };
	const latest = { ...base, at: "2026-09-09T10:00:00Z", release: "b" };
	const browser = {
		...latest,
		source: "browser" as const,
		context: { userId: 99 },
	};
	const summary = summarizeErrorGroup([
		latest,
		browser,
		first,
		{ ...latest, context: { userId: "12" } },
		{ ...latest, context: { email: "redacted", userId: "[REDACTED]" } },
	]);
	expect(summary.count).toBe(5);
	expect(summary.firstAt).toBe(first.at);
	expect(summary.lastAt).toBe(latest.at);
	expect(summary.affectedUsers).toBe(1);
	expect(summary.unidentified).toBe(2);
	expect(summary.releases.map((r) => [r.release, r.count])).toEqual([
		["a", 1],
		["b", 4],
	]);
});
it("creates only recognized local operation links", () => {
	const base = createErrorRecord("server", "test", "failed", {
		module: "news",
		articleId: 7,
	});
	expect(errorOperationLink(base)).toBe("/admin/articles/7");
	expect(
		errorOperationLink({
			...base,
			context: { module: "news", articleId: "../settings" },
		}),
	).toBe("/admin/articles");
	expect(
		errorOperationLink({
			...base,
			source: "browser",
			context: { path: "/admin/media" },
		}),
	).toBe("/admin/media");
	for (const path of [
		"https://evil.invalid",
		"//evil.invalid",
		"/admin/articles/1?token=x",
		"/admin/articles/../settings",
		"/admin/users/42",
		"javascript:alert(1)",
		"/admin/%61rticles",
	])
		expect(errorOperationLink({ ...base, context: { path } })).toBeNull();
});

it("links server operation IDs to the audit search without trusting browser IDs", () => {
	const record = createErrorRecord("server", "test", "failed", {
		operationId: "op-123",
	});
	expect(summarizeErrorGroup([record]).auditLink).toBe(
		"/admin/logs/audit?search=op-123",
	);
	expect(
		summarizeErrorGroup([{ ...record, source: "browser" }]).auditLink,
	).toBeNull();
	expect(
		summarizeErrorGroup([
			{ ...record, context: { operationId: "../../secrets" } },
		]).auditLink,
	).toBeNull();
});

it("links a server delivery error to its exact persisted delivery only", () => {
	const id = "840f4023-04cd-4d7b-92c5-047aa620029c";
	const record = createErrorRecord(
		"server",
		"Delivery failed",
		"private failure",
		{ module: "operations", deliveryId: id },
	);
	expect(errorOperationLink(record)).toBe(`/admin/devops/deliveries?id=${id}`);
	expect(errorOperationLink({ ...record, source: "browser" })).toBeNull();
	expect(
		errorOperationLink({
			...record,
			context: { module: "operations", deliveryId: "../settings" },
		}),
	).toBeNull();
});
