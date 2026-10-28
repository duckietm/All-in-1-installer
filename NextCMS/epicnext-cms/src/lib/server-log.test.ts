// @ts-nocheck
import { describe, expect, it } from "vitest";
import { serverErrorRecord } from "@/lib/server-log";

describe("serverErrorRecord", () => {
	it("keeps operational context while redacting sensitive fields", () => {
		expect(
			serverErrorRecord("paypal.capture_failed", new Error("gateway timeout"), {
				orderId: "ORDER-123",
				userId: 42,
				authorization: "Bearer secret",
				apiToken: "secret-token",
			}),
		).toEqual({
			level: "error",
			event: "paypal.capture_failed",
			message: "gateway timeout",
			context: {
				orderId: "ORDER-123",
				userId: 42,
				authorization: "[REDACTED]",
				apiToken: "[REDACTED]",
			},
		});
	});

	it("normalizes non-Error failures without serializing arbitrary objects", () => {
		expect(
			serverErrorRecord("admin.update_failed", { password: "secret" }),
		).toMatchObject({
			message: "Unknown server error",
		});
	});
});
