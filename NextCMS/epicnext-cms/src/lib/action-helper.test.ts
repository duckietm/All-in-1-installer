// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

const loggerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	logger: { error: loggerError },
}));

import { actionError, wrapAction } from "./action-helper";

describe("wrapAction", () => {
	it("returns success result on happy path", async () => {
		const fn = vi.fn().mockResolvedValue({ id: 1 });
		const result = await wrapAction(fn, "test_action");
		expect(result.ok).toBe(true);
		expect(result.data).toEqual({ id: 1 });
	});

	it("returns error result on thrown exception", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("DB error"));
		const result = await wrapAction(fn, "failing_action");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("DB error");
		expect(loggerError).toHaveBeenCalled();
	});

	it("catches non-Error values gracefully", async () => {
		const fn = vi.fn().mockRejectedValue("string error");
		const result = await wrapAction(fn, "bad_action");
		expect(result.ok).toBe(false);
	});

	it("returns data returned by fn", async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		const result = await wrapAction(fn, "void_action");
		expect(result.ok).toBe(true);
	});
});

describe("actionError", () => {
	it("returns failure result with message", () => {
		const result = actionError("some_action", "something went wrong");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("something went wrong");
	});

	it("logs the error", () => {
		actionError("audit_action", "audit failed");
		expect(loggerError).toHaveBeenCalledWith(
			"Action failed: audit_action",
			expect.objectContaining({
				action: "audit_action",
				error: "audit failed",
			}),
		);
	});
});
