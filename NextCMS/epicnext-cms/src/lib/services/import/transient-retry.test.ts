import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isTransientImportError,
	withTransientImportRetry,
} from "./transient-retry";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("isTransientImportError", () => {
	it("flags connection and timeout classes", () => {
		for (const message of [
			"fetch failed",
			"network error during download",
			"service unavailable",
			"HTTP 503",
			"HTTP 500",
			"Empty or truncated response",
			"connection timed out",
			"ECONNRESET",
		]) {
			expect(isTransientImportError(message)).toBe(true);
		}
	});

	it("does not flag data errors or aborts", () => {
		for (const message of [
			undefined,
			"Response is not a SWF file",
			"Invalid Nitro bundle",
			"This operation was aborted",
			"classname missing in assets",
			"HTTP 404",
		]) {
			expect(isTransientImportError(message)).toBe(false);
		}
	});
});

describe("withTransientImportRetry", () => {
	it("returns success on the first attempt", async () => {
		const attempt = vi.fn(async () => ({ ok: true as const, itemId: 1 }));
		await expect(withTransientImportRetry(attempt)).resolves.toEqual({
			ok: true,
			itemId: 1,
		});
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	it("retries transient failures until success", async () => {
		const attempt = vi
			.fn()
			.mockResolvedValueOnce({ ok: false as const, error: "fetch failed" })
			.mockResolvedValueOnce({ ok: false as const, error: "HTTP 503" })
			.mockResolvedValueOnce({ ok: true as const, itemId: 7 });
		const pending = withTransientImportRetry(attempt, 2);
		await vi.advanceTimersByTimeAsync(2000);
		await expect(pending).resolves.toEqual({ ok: true, itemId: 7 });
		expect(attempt).toHaveBeenCalledTimes(3);
	});

	it("returns the last error after exhausting retries", async () => {
		const attempt = vi.fn(async () => ({
			ok: false as const,
			error: "fetch failed",
		}));
		const pending = withTransientImportRetry(attempt, 2);
		await vi.advanceTimersByTimeAsync(2000);
		await expect(pending).resolves.toEqual({
			ok: false,
			error: "fetch failed",
		});
		expect(attempt).toHaveBeenCalledTimes(3);
	});

	it("does not retry non-transient failures", async () => {
		const attempt = vi.fn(async () => ({
			ok: false as const,
			error: "Invalid Nitro bundle",
		}));
		await expect(withTransientImportRetry(attempt)).resolves.toEqual({
			ok: false,
			error: "Invalid Nitro bundle",
		});
		expect(attempt).toHaveBeenCalledTimes(1);
	});
});
