// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOperationContext } from "./foundation/request-context";

const state = vi.hoisted(() => ({
	authorized: true,
	permitted: true,
	csrf: true,
	record: vi.fn(),
}));
vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: vi.fn(),
}));
vi.mock("@/lib/foundation/security", () => ({
	validateCsrfToken: async () => state.csrf,
}));
vi.mock("@/lib/permissions", () => ({
	getApiAdminContext: async () =>
		state.authorized
			? { session: { user: { id: 42, rank: 7 } }, permissions: [] }
			: null,
	canAccess: () => state.permitted,
}));
vi.mock("@/lib/performance-store", () => ({ recordPerformance: state.record }));
vi.mock("@/lib/server-log", () => ({
	logServerError: () => "error-reference",
}));
vi.mock("@/lib/services/catalog-git-queue", () => ({
	catalogExportEnabled: () => false,
	isCatalogMutation: () => false,
	beginCatalogExport: vi.fn(),
}));

import { emptyRouteContext } from "@/test/route-context";
import { withAdmin } from "./api-handler";

const request = () =>
	new NextRequest("https://hotel.test/cms_api/admin/example", {
		headers: { "x-operation-id": "forged-client-id" },
	});
describe("admin API correlation", () => {
	beforeEach(() => {
		state.authorized = true;
		state.permitted = true;
		state.csrf = true;
		state.record.mockClear();
	});
	it("matches the response ID to asynchronous work without trusting a supplied ID", async () => {
		const handler = withAdmin({ permission: "users.view" }, async () => {
			await Promise.resolve();
			return NextResponse.json(getOperationContext());
		});
		const [a, b] = await Promise.all([
			handler(request(), emptyRouteContext()),
			handler(request(), emptyRouteContext()),
		]);
		expect(a.headers.get("x-operation-id")).not.toBe("forged-client-id");
		expect(a.headers.get("x-operation-id")).not.toBe(
			b.headers.get("x-operation-id"),
		);
		expect(await a.json()).toEqual({
			operationId: a.headers.get("x-operation-id"),
			userId: 42,
		});
		expect(getOperationContext()).toEqual({});
	});
	it("preserves redirects and separate set-cookie values", async () => {
		const handler = withAdmin({}, () => {
			const response = NextResponse.redirect(
				"https://hotel.test/admin/users",
				307,
			);
			response.cookies.set("first", "one", { httpOnly: true });
			response.cookies.set("second", "two", { httpOnly: true });
			return response;
		});
		const response = await handler(request(), emptyRouteContext());
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"https://hotel.test/admin/users",
		);
		expect(response.headers.getSetCookie()).toHaveLength(2);
		expect(response.headers.getSetCookie()).toEqual(
			expect.arrayContaining([
				expect.stringContaining("first=one"),
				expect.stringContaining("second=two"),
			]),
		);
		expect(response.headers.get("x-operation-id")).toBeTruthy();
	});
	it("returns streaming headers before completion and preserves every chunk", async () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const handler = withAdmin(
			{},
			() =>
				new Response(
					new ReadableStream({
						start(value) {
							controller = value;
						},
					}),
					{
						headers: {
							"content-type": "text/event-stream",
							"x-custom": "retained",
						},
					},
				),
		);
		const response = await handler(request(), emptyRouteContext());
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("x-custom")).toBe("retained");
		const body = response.text();
		controller?.enqueue(new TextEncoder().encode("data: first\n\n"));
		controller?.enqueue(new TextEncoder().encode("data: last\n\n"));
		controller?.close();
		expect(await body).toBe("data: first\n\ndata: last\n\n");
		expect(state.record).toHaveBeenCalledWith(
			expect.objectContaining({ streaming: true }),
		);
	});
	it("adds correlation to authentication, permission and handler failures", async () => {
		const handler = withAdmin({ permission: "users.view" }, () => {
			throw new Error("private-database-message");
		});
		state.authorized = false;
		const unauthorized = await handler(request(), emptyRouteContext());
		expect(unauthorized.status).toBe(401);
		expect(state.record).not.toHaveBeenCalled();
		expect(unauthorized.headers.get("x-operation-id")).toBeTruthy();
		state.authorized = true;
		state.permitted = false;
		const forbidden = await handler(request(), emptyRouteContext());
		expect(forbidden.status).toBe(403);
		expect(forbidden.headers.get("x-operation-id")).toBeTruthy();
		state.permitted = true;
		const failed = await handler(request(), emptyRouteContext());
		expect(failed.status).toBe(500);
		expect(failed.headers.get("x-operation-id")).toBeTruthy();
		expect(await failed.json()).toEqual({
			ok: false,
			error: "Internal server error",
			errorId: "error-reference",
		});
	});
});
