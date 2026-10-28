import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	cookies: vi.fn(),
	headers: vi.fn(),
}));

vi.mock("next/headers", () => ({
	cookies: mocks.cookies,
	headers: mocks.headers,
}));

import { readCsrfCookieToken } from "./security";

describe("readCsrfCookieToken", () => {
	beforeEach(() => {
		mocks.cookies.mockReset();
	});

	it("reads an existing valid CSRF cookie without attempting a write", async () => {
		const token = "a".repeat(64);
		const set = vi.fn();
		mocks.cookies.mockResolvedValue({
			get: (name: string) =>
				name === "__Host-csrf-token" ? { value: token } : undefined,
			set,
		});

		await expect(readCsrfCookieToken()).resolves.toBe(token);
		expect(set).not.toHaveBeenCalled();
	});

	it("returns an empty token when no valid cookie exists", async () => {
		mocks.cookies.mockResolvedValue({
			get: () => undefined,
			set: vi.fn(),
		});

		await expect(readCsrfCookieToken()).resolves.toBe("");
	});
});
