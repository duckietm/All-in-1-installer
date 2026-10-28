import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	setCsrfCookie: vi.fn(),
}));

vi.mock("@/lib/api-handler", () => ({
	withAdmin:
		(_options: unknown, handler: (...args: never[]) => unknown) =>
		(...args: never[]) =>
			handler(...args),
}));

vi.mock("@/lib/foundation/security", () => ({
	setCsrfCookie: mocks.setCsrfCookie,
}));

import { emptyRouteContext } from "@/test/route-context";
import { GET } from "./route";

describe("admin CSRF bootstrap route", () => {
	beforeEach(() => {
		mocks.setCsrfCookie.mockReset();
	});

	it("returns the token written by the route handler without caching", async () => {
		const token = "a".repeat(64);
		mocks.setCsrfCookie.mockResolvedValue(token);

		const response = await GET(
			new NextRequest("http://localhost/api/admin/csrf"),
			emptyRouteContext(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ ok: true, token });
	});

	it("fails closed when the cookie cannot be written", async () => {
		mocks.setCsrfCookie.mockResolvedValue("");

		const response = await GET(
			new NextRequest("http://localhost/api/admin/csrf"),
			emptyRouteContext(),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Unable to initialize CSRF token",
		});
	});
});
