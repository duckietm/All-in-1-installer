// @ts-nocheck
import { expect, it } from "vitest";
import { createErrorRecord } from "./error-monitor";

it("captures diagnostic data without serializing arbitrary request bodies", () => {
	const record = createErrorRecord(
		"server",
		"request.failed",
		new Error("failure"),
		{ body: { password: "secret" }, path: "/admin/studio" },
	);
	expect(record.context.body).toBe("[REDACTED]");
	expect(record.context.path).toBe("/admin/studio");
	expect(record.stack).toContain("failure");
});
